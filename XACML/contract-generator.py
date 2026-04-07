"""
contract_generator.py  —  VLDB-2026
Generates Solidity smart contracts from XACML policy files and JSON terms.

Uses string[] memory inputs array pattern (not individual params) to stay
within EVM 16-slot stack limit even with many attributes.

Conditions are also split into chunk functions (check_0, check_1 ...) of
6 conditions each to further reduce per-function stack usage.

Usage:
    python contract_generator.py <xacml_file> <terms_json_file>
"""

import xml.etree.ElementTree as ET
import json
import hashlib
import sys
import os
import re

PUBLIC_KEY = "0x45311dFE4E1E5066fE1B4B40c745c8749995968F"


def read_xacml(file_name):
    ns = {"xacml": "urn:oasis:names:tc:xacml:3.0:core:schema:wd-17"}
    tree = ET.parse(file_name)
    root = tree.getroot()

    data = {}
    int_attrs = {}
    ordered_keys = []

    for match in root.findall(".//xacml:Target/xacml:AnyOf/xacml:AllOf/xacml:Match", ns):
        match_id  = match.attrib.get("MatchId", "")
        attr_node = match.find("xacml:AttributeDesignator", ns)
        val_node  = match.find("xacml:AttributeValue", ns)
        if attr_node is None or val_node is None:
            continue

        attr_id = attr_node.attrib["AttributeId"]
        value   = val_node.text.strip()

        if "integer-greater-than-or-equal" in match_id:
            if attr_id not in int_attrs:
                int_attrs[attr_id] = int(value)
                ordered_keys.append(attr_id)
            continue

        if attr_id not in data:
            data[attr_id] = []
            ordered_keys.append(attr_id)
        if value not in data[attr_id]:
            data[attr_id].append(value)

    # deduplicate keys
    seen, keys = set(), []
    for k in ordered_keys:
        if k not in seen:
            seen.add(k)
            keys.append(k)

    return keys, data, int_attrs


def read_terms(file_name):
    with open(file_name, "r", encoding="utf-8") as f:
        terms = json.load(f)
    return {
        hashlib.sha256(v.encode()).hexdigest(): v
        for k, v in terms.items()
        if k.startswith("term")
    }


def generate_contract(contract_name, ordered_keys, data, int_attrs, hashed_terms):
    n_terms  = len(hashed_terms)
    n_inputs = len(ordered_keys)

    # ── Constructor ────────────────────────────────────────────────────────────
    policy_lines = []
    for key in ordered_keys:
        if key in int_attrs:
            policy_lines.append(f'        datasetPolicies["{key}"] = "{int_attrs[key]}";')
        else:
            vals = data[key]
            policy_lines.append(
                f'        datasetPolicies["{key}"] = "{",".join(vals)}";'
            )
    for h in hashed_terms:
        policy_lines.append(f'        datasetPolicies["{h}"] = "yes";')
    policy_block = "\n".join(policy_lines)

    # ── getPolicy ──────────────────────────────────────────────────────────────
    policy_fields = ",".join(ordered_keys)

    # ── term params ────────────────────────────────────────────────────────────
    term_params = ""
    if n_terms:
        term_params = ", " + ", ".join(f"string memory term{i}" for i in range(n_terms))

    # ── concatenation ──────────────────────────────────────────────────────────
    concat_lines = ['        string memory concatenated = inputs[0];']
    for i in range(1, n_inputs):
        concat_lines.append(
            f'        concatenated = string(abi.encodePacked(concatenated, ",", inputs[{i}]));'
        )
    for i in range(n_terms):
        concat_lines.append(
            f'        concatenated = string(abi.encodePacked(concatenated, ",", term{i}));'
        )
    concat_block = "\n".join(concat_lines)

    # ── term hash extraction ───────────────────────────────────────────────────
    term_hash_lines = [f'        string[] memory term_hashes = new string[]({n_terms});']
    for i in range(n_terms):
        term_hash_lines.append(f'        term_hashes[{i}] = extractHash(term{i});')
    term_hash_block = "\n".join(term_hash_lines)

    # ── conditions split into chunk functions ──────────────────────────────────
    conditions = []
    for i, key in enumerate(ordered_keys):
        if key in int_attrs:
            conditions.append(
                f'stringToUint(datasetPolicies["{key}"]) <= stringToUint(inputs[{i}])'
            )
        else:
            vals = data[key]
            if len(vals) > 1:
                conditions.append(f'checkArray(datasetPolicies["{key}"], inputs[{i}])')
            else:
                conditions.append(
                    f'keccak256(abi.encodePacked(datasetPolicies["{key}"])) == '
                    f'keccak256(abi.encodePacked(inputs[{i}]))'
                )
    for i in range(n_terms):
        conditions.append(
            f'keccak256(abi.encodePacked(datasetPolicies[term_hashes[{i}]])) == '
            f'keccak256(abi.encodePacked("yes"))'
        )

    CHUNK = 5
    chunks = [conditions[i:i+CHUNK] for i in range(0, len(conditions), CHUNK)]

    permit_expr = " &&\n            ".join(
        f"check_{ci}(inputs, term_hashes)" for ci in range(len(chunks))
    )

    check_fns_block = ""
    for ci, chunk in enumerate(chunks):
        cond_str = " &&\n            ".join(chunk)
        check_fns_block += f"""
    function check_{ci}(string[] memory inputs, string[] memory term_hashes) internal view returns (bool) {{
        return {cond_str};
    }}
"""

    # ── failed terms ───────────────────────────────────────────────────────────
    failed_terms_block = f"""        if (!permit) {{
            string[] memory failedTerms = new string[]({n_terms});
            uint count = 0;
            for (uint i = 0; i < {n_terms}; i++) {{
                if (keccak256(abi.encodePacked(datasetPolicies[term_hashes[i]])) != keccak256(abi.encodePacked("yes"))) {{
                    failedTerms[count] = term_hashes[i];
                    count++;
                }}
            }}
            for (uint i = 0; i < count; i++) {{
                decision = string(abi.encodePacked(decision, " -- Failed Term: ", failedTerms[i]));
            }}
        }}"""

    return f"""// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.4.22 <0.9.0;

import "@openzeppelin/contracts/utils/Strings.sol";

contract {contract_name} {{
    using Strings for uint256;

    address public constant publicKey = {PUBLIC_KEY};

    event SignUpResult(string success);

    mapping(string => string) datasetPolicies;

    constructor() {{
{policy_block}
    }}

    function getPolicy() public pure returns (string memory) {{
        return "{policy_fields}";
    }}

    function evaluate(
        string memory datasetID,
        string[] memory inputs{term_params},
        bytes memory signature
    ) public {{
        require(inputs.length == {n_inputs}, "Wrong number of inputs");

{concat_block}

        require(verify(publicKey, concatenated, signature) == true, "Invalid signature");

{term_hash_block}

        bool permit = {permit_expr};

        string memory myAddress = convert();
        string memory decision = string(
            abi.encodePacked(
                permit ? "Decision: true" : "Decision: false",
                " -- Address:", myAddress,
                " -- Dataset ID:", datasetID
            )
        );

{failed_terms_block}

        emit SignUpResult(decision);
    }}
{check_fns_block}
    function extractHash(string memory term) internal pure returns (string memory) {{
        bytes memory b = bytes(term);
        uint col = 0;
        for (uint i = 0; i < b.length; i++) {{
            if (b[i] == ":") {{ col = i; break; }}
        }}
        bytes memory h = new bytes(b.length - col - 1);
        for (uint i = col + 1; i < b.length; i++) {{
            h[i - col - 1] = b[i];
        }}
        return string(h);
    }}

    function checkArray(string memory arrayStr, string memory value) internal pure returns (bool) {{
        bytes memory a = bytes(arrayStr);
        bytes memory v = bytes(value);
        uint start = 0;
        for (uint i = 0; i <= a.length; i++) {{
            if (i == a.length || a[i] == ",") {{
                if (keccak256(abi.encodePacked(slice(a, start, i - start))) == keccak256(abi.encodePacked(v))) {{
                    return true;
                }}
                start = i + 1;
            }}
        }}
        return false;
    }}

    function slice(bytes memory data, uint start, uint len) internal pure returns (bytes memory) {{
        bytes memory result = new bytes(len);
        for (uint i = 0; i < len; i++) {{ result[i] = data[start + i]; }}
        return result;
    }}

    function stringToUint(string memory s) internal pure returns (uint) {{
        bytes memory b = bytes(s);
        uint result = 0;
        for (uint i = 0; i < b.length; i++) {{
            if (b[i] >= 0x30 && b[i] <= 0x39) {{
                result = result * 10 + (uint(uint8(b[i])) - 48);
            }}
        }}
        return result;
    }}

    function getMessageHash(string memory _message) public pure returns (bytes32) {{
        return keccak256(abi.encodePacked(_message));
    }}

    function getEthSignedMessageHash(bytes32 _messageHash) public pure returns (bytes32) {{
        return keccak256(abi.encodePacked("\\x19Ethereum Signed Message:\\n32", _messageHash));
    }}

    function verify(address _signer, string memory _message, bytes memory signature) public pure returns (bool) {{
        bytes32 messageHash = getMessageHash(_message);
        bytes32 ethSignedMessageHash = getEthSignedMessageHash(messageHash);
        return recoverSigner(ethSignedMessageHash, signature) == _signer;
    }}

    function recoverSigner(bytes32 _ethSignedMessageHash, bytes memory _signature) public pure returns (address) {{
        (bytes32 r, bytes32 s, uint8 v) = splitSignature(_signature);
        return ecrecover(_ethSignedMessageHash, v, r, s);
    }}

    function splitSignature(bytes memory sig) public pure returns (bytes32 r, bytes32 s, uint8 v) {{
        require(sig.length == 65, "invalid signature length");
        assembly {{
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }}
    }}

    function convert() public view returns (string memory) {{
        return toString(msg.sender);
    }}

    function toString(address _addr) internal pure returns (string memory) {{
        bytes32 value = bytes32(uint256(uint160(_addr)));
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(42);
        str[0] = "0"; str[1] = "x";
        for (uint256 i = 0; i < 20; i++) {{
            str[2 + i * 2] = alphabet[uint8(value[i + 12] >> 4)];
            str[3 + i * 2] = alphabet[uint8(value[i + 12] & 0x0f)];
        }}
        return string(str);
    }}
}}
"""


def main():
    if len(sys.argv) < 3:
        print("Usage: python contract_generator.py <xacml_file> <terms_json_file>")
        sys.exit(1)

    xacml_file    = sys.argv[1]
    terms_file    = sys.argv[2]
    base          = os.path.basename(xacml_file)
    name          = os.path.splitext(base)[0]
    contract_name = re.sub(r"[^a-zA-Z0-9_]", "_", name)

    print(f"Reading XACML : {xacml_file}")
    print(f"Reading terms : {terms_file}")
    print(f"Contract name : {contract_name}")

    ordered_keys, data, int_attrs = read_xacml(xacml_file)
    hashed_terms = read_terms(terms_file)

    print(f"Attributes ({len(ordered_keys)}): {ordered_keys}")
    print(f"Integer attrs : {int_attrs}")
    print(f"Terms hashed  : {len(hashed_terms)}")

    contract = generate_contract(contract_name, ordered_keys, data, int_attrs, hashed_terms)

    out_file = f"smart-contract-{contract_name}.sol"
    with open(out_file, "w") as f:
        f.write(contract)
    print(f"Written: {out_file}")


if __name__ == "__main__":
    main()