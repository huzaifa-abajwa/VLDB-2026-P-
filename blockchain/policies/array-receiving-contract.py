import xml.etree.ElementTree as ET
import json
import hashlib
import sys
import os


def read_xacml(file_name):
    ns = {"xacml": "urn:oasis:names:tc:xacml:3.0:core:schema:wd-17"}
    tree = ET.parse(file_name)
    root = tree.getroot()

    data = {}
    for target in root.findall(
        ".//xacml:Target/xacml:AnyOf/xacml:AllOf/xacml:Match", ns
    ):
        key = target.find("xacml:AttributeDesignator", ns).attrib["AttributeId"]
        value = target.find("xacml:AttributeValue", ns).text
        if key not in data:
            data[key] = []
        data[key].append(value)

    for key, value in data.items():
        if len(value) == 1:
            data[key] = value[0]
        elif len(set(value)) == 1:
            data[key] = value[0]  # All values identical, simplify to single
    return data


def read_terms(file_name):
    with open(file_name, "r") as file:
        terms = json.load(file)

    hashed_terms = {
        hashlib.sha256(value.encode()).hexdigest(): value
        for key, value in terms.items()
        if key.startswith("term")
    }
    return hashed_terms


def generate_evaluate_function(data, hashed_terms):
    conditions = []
    for key, value in data.items():
        if isinstance(value, list):
            condition = f'checkArray(datasetPolicies["{key}"], inputs[{list(data.keys()).index(key)}])'
        elif isinstance(value, int) or (isinstance(value, str) and value.isdigit()):
            condition = f'stringToUint(datasetPolicies["{key}"]) <= stringToUint(inputs[{list(data.keys()).index(key)}])'
        else:
            condition = f'keccak256(abi.encodePacked(datasetPolicies["{key}"])) == keccak256(abi.encodePacked(inputs[{list(data.keys()).index(key)}]))'
        conditions.append(condition)

    term_conditions = []
    for index in range(len(hashed_terms)):
        term_conditions.append(
            f"keccak256(abi.encodePacked(datasetPolicies[term_hashes[{index}]])) == keccak256(abi.encodePacked(term_values[{index}]))"
        )

    condition_string = " && ".join(conditions + term_conditions)
    return condition_string


def generate_contract(data, hashed_terms, fileName):
    keys = list(data.keys())
    evaluate_conditions = generate_evaluate_function(data, hashed_terms)
    policy_lines = "\n".join(
        [
            f'        datasetPolicies["{key}"] = "{value}";'
            for key, value in data.items()
            if not isinstance(value, list)
        ]
    )
    policy_lines += "\n" + "\n".join(
        [
            f'        datasetPolicies["{key}"] = "{",".join(value)}";'
            for key, value in data.items()
            if isinstance(value, list)
        ]
    )
    policy_lines += "\n" + "\n".join(
        [
            f'        datasetPolicies["{hash_value}"] = "yes";'
            for hash_value in hashed_terms.keys()
        ]
    )
    input_fields = ",".join(keys)
    parameters = ",".join(
        [f"string memory term{index}" for index in range(len(hashed_terms))]
    )
    term_list = ",".join([f"term{index}" for index in range(len(hashed_terms))])

    term_extractions = "\n".join(
        [
            f"        (term_hashes[{i}], term_values[{i}]) = extractValueAndHash(term{i});"
            for i in range(len(hashed_terms))
        ]
    )

    term_concat = "\n".join(
        [
            f'            concatenatedInputs = string(abi.encodePacked(concatenatedInputs, ",", term{i}));'
            for i in range(len(hashed_terms))
        ]
    )

    base_contract = f"""
// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.4.22 <0.9.0;

import "@openzeppelin/contracts/utils/Strings.sol";

contract {fileName} {{
    using Strings for uint256;

    address public constant publicKey =
        0x45311dFE4E1E5066fE1B4B40c745c8749995968F;

    event SignUpResult(string success);

    // Store dataset-specific access control policies
    mapping(string => string) datasetPolicies;

    constructor() {{{{
{policy_lines}
    }}}}

    function getPolicy() public pure returns (string memory) {{{{
        return "{input_fields}";
    }}}}

    function evaluate(
        string memory datasetID,
        string[] memory inputs,
        {parameters},
        bytes memory signature
    ) public {{{{
        // Verifying the Signature first:
        string memory concatenatedInputs = concatenateInputs(inputs, {term_list});
        require(
            verify(
                publicKey,
                concatenatedInputs,
                signature
            ) == true,
            "Invalid signature"
        );

        string[] memory term_values = new string[]({len(hashed_terms)});
        string[] memory term_hashes = new string[]({len(hashed_terms)});
{term_extractions}

        // Policy Evaluation
        bool permit = evaluatePolicies(inputs, term_values, term_hashes);
        string memory decision = generateDecision(permit, datasetID, term_hashes, term_values);
        emit SignUpResult(decision);
    }}}}

    function concatenateInputs(string[] memory inputs, {parameters}) internal pure returns (string memory) {{{{
        string memory concatenatedInputs = "";
        for (uint i = 0; i < inputs.length; i++) {{{{
            if (i == 0) {{{{
                concatenatedInputs = inputs[i];
            }}}} else {{{{
                concatenatedInputs = string(abi.encodePacked(concatenatedInputs, ",", inputs[i]));
            }}}}
        }}}}
{term_concat}
        return concatenatedInputs;
    }}}}

    function evaluatePolicies(
        string[] memory inputs,
        string[] memory term_values,
        string[] memory term_hashes
    ) internal view returns (bool) {{{{
        return {evaluate_conditions};
    }}}}

    function generateDecision(
        bool permit,
        string memory datasetID,
        string[] memory term_hashes,
        string[] memory term_values
    ) internal view returns (string memory) {{{{
        string memory myAddress = convert();
        string memory decision = string(
            abi.encodePacked(
                permit ? "Decision: true" : "Decision: false",
                " -- Address:",
                myAddress,
                " -- Dataset ID:",
                datasetID
            )
        );

        if (!permit) {{{{
            string[] memory failedTerms = new string[]({len(hashed_terms)});
            uint count = 0;
            for (uint i = 0; i < {len(hashed_terms)}; i++) {{{{
                string memory term_hash = term_hashes[i];
                string memory term_value = term_values[i];
                if (keccak256(abi.encodePacked(datasetPolicies[term_hash])) != keccak256(abi.encodePacked(term_value))) {{{{
                    failedTerms[count] = term_hash;
                    count++;
                }}}}
            }}}}
            for (uint i = 0; i < count; i++) {{{{
                decision = string(abi.encodePacked(decision, " -- Failed Term: ", failedTerms[i]));
            }}}}
        }}}}

        return decision;
    }}}}

    function extractValueAndHash(string memory term) internal pure returns (string memory, string memory) {{{{
        bytes memory termBytes = bytes(term);
        uint colonIndex = 0;

        for (uint i = 0; i < termBytes.length; i++) {{{{
            if (termBytes[i] == ":") {{{{
                colonIndex = i;
                break;
            }}}}
        }}}}

        bytes memory valueBytes = new bytes(termBytes.length - colonIndex - 1);
        for (uint i = colonIndex + 1; i < termBytes.length; i++) {{{{
            valueBytes[i - colonIndex - 1] = termBytes[i];
        }}}}

        bytes memory hashBytes = new bytes(colonIndex);
        for (uint i = 0; i < colonIndex; i++) {{{{
            hashBytes[i] = termBytes[i];
        }}}}

        return (string(valueBytes), string(hashBytes));
    }}}}

    function checkArray(string memory arrayStr, string memory value) internal pure returns (bool) {{{{
        bytes memory arrayStrBytes = bytes(arrayStr);
        bytes memory valueBytes = bytes(value);
        bool found = false;
        uint start = 0;
        
        for (uint i = 0; i <= arrayStrBytes.length; i++) {{{{
            if (i == arrayStrBytes.length || arrayStrBytes[i] == ",") {{{{
                if (keccak256(abi.encodePacked(slice(arrayStrBytes, start, i - start))) == keccak256(abi.encodePacked(valueBytes))) {{{{
                    found = true;
                    break;
                }}}}
                start = i + 1;
            }}}}
        }}}}
        
        return found;
    }}}}

    function slice(bytes memory data, uint start, uint len) internal pure returns (bytes memory) {{{{
        bytes memory result = new bytes(len);
        for (uint i = 0; i < len; i++) {{{{
            result[i] = data[start + i];
        }}}}
        return result;
    }}}}

    function stringToUint(string memory s) internal pure returns (uint) {{{{
        bytes memory b = bytes(s);
        uint result = 0;
        for (uint i = 0; i < b.length; i++) {{{{
            if (b[i] >= 0x30 && b[i] <= 0x39) {{{{
                result = result * 10 + (uint(uint8(b[i])) - 48);
            }}}}
        }}}}
        return result;
    }}}}

    function getMessageHash(
        string memory _message
    ) public pure returns (bytes32) {{{{
        return keccak256(abi.encodePacked(_message));
    }}}}

    function getEthSignedMessageHash(
        bytes32 _messageHash
    ) public pure returns (bytes32) {{{{
        return
            keccak256(
                abi.encodePacked(
                    "\\x19Ethereum Signed Message:\\n32",
                    _messageHash
                )
            );
    }}}}

    function verify(
        address _signer,
        string memory _message,
        bytes memory signature
    ) public pure returns (bool) {{{{
        bytes32 messageHash = getMessageHash(_message);
        bytes32 ethSignedMessageHash = getEthSignedMessageHash(messageHash);

        return recoverSigner(ethSignedMessageHash, signature) == _signer;
    }}}}

    function recoverSigner(
        bytes32 _ethSignedMessageHash,
        bytes memory _signature
    ) public pure returns (address) {{{{
        (bytes32 r, bytes32 s, uint8 v) = splitSignature(_signature);

        return ecrecover(_ethSignedMessageHash, v, r, s);
    }}}}

    function splitSignature(
        bytes memory sig
    ) public pure returns (bytes32 r, bytes32 s, uint8 v) {{{{
        require(sig.length == 65, "invalid signature length");

        assembly {{{{
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }}}}
    }}}}

    function convert() public view returns (string memory) {{{{
        address addr = msg.sender;
        return toString(addr);
    }}}}

    function toString(address _addr) internal pure returns (string memory) {{{{
        bytes32 value = bytes32(uint256(uint160(_addr)));
        bytes memory alphabet = "0123456789abcdef";

        bytes memory str = new bytes(42);
        str[0] = '0';
        str[1] = 'x';

        for (uint256 i = 0; i < 20; i++) {{{{
            str[2 + i * 2] = alphabet[uint8(value[i + 12] >> 4)];
            str[3 + i * 2] = alphabet[uint8(value[i + 12] & 0x0f)];
        }}}}
        return string(str);
    }}}}
}}
    """
    return base_contract


def main():

    if len(sys.argv) != 3:
        print("Usage: python xacml-parser.py <file.xml> <output_dir>")
        sys.exit(1)

    file_path = sys.argv[1]
    output_dir = sys.argv[2]
    data = read_xacml(file_path)
    base_name = os.path.basename(file_path)  # Get the file name with extension

    ## Reading the Json file :
    base_name_no_ext = os.path.splitext(base_name)[0]
    json_file_path = os.path.join(
        os.path.dirname(file_path), base_name_no_ext + ".json"
    )

    hashed_terms = read_terms(json_file_path)
    sol_file_name = base_name.replace(".xml", ".sol")
    contract = generate_contract(
        data, hashed_terms, base_name.replace(".xml", "").replace("@", "_")
    )

    sol_file_path = os.path.join(
        output_dir, sol_file_name
    )  # Store in the output directory

    with open(sol_file_path, "w") as f:
        f.write(contract)

    # xacml_file_name = "policy.xml"
    # json_terms_file_name = "terms.json"

    # data = read_xacml(xacml_file_name)
    # hashed_terms = read_terms(json_terms_file_name)

    # contract = generate_contract(data, hashed_terms)
    # with open(f"smart-contract.sol", "w") as f:
    #     f.write(contract)
    # print("Contract generated successfully!")


if __name__ == "__main__":
    main()
