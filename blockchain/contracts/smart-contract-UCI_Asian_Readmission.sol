
// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.4.22 <0.9.0;

import "@openzeppelin/contracts/utils/Strings.sol";

contract UCI_Asian_Readmission {
    using Strings for uint256;

    address public constant publicKey =
        0x45311dFE4E1E5066fE1B4B40c745c8749995968F;

    event SignUpResult(string success);

    // Store dataset-specific access control policies
    mapping(string => string) datasetPolicies;

    constructor() {{
        datasetPolicies["grantId"] = "grant-id-42857";
        datasetPolicies["experienceYears"] = "3";
        datasetPolicies["personRole"] = "researcher,clinical-researcher,medical-scientist,data-scientist,data-analyst";
        datasetPolicies["specialization"] = "medical-research,bioinformatics,data-analysis";
        datasetPolicies["designation"] = "researcher,postdoctoral-fellow,phd-student";
        datasetPolicies["fromNetworks"] = "hospital-network,university-network,research-institute-network";
        datasetPolicies["department"] = "bioinformatics,computer-science,biology";
        datasetPolicies["certifications"] = "undergraduate,masters,PhD,board-certified,fellowship-trained,certified-clinical-researcher";
        datasetPolicies["researchFocus"] = "bioinformatics,computer-science,biomedical-engineering";
        datasetPolicies["authorizedBy"] = "faculty-advisor,administrator,department-head,hospital-administrator,project-director,research-institute-director";
        datasetPolicies["fc513b2e3d4c8c371e8447ca75127fc542610f317761b737d400d4e86f0e2e6f"] = "yes";
        datasetPolicies["d08cfcf9d5e4ff4ce9279126277b19bd31eb742e56508d300e1453cfed746eab"] = "yes";
        datasetPolicies["3dab36d4640c639d14393d57954e10cdfe76d71216c6cf5ce3e387b817426ee3"] = "yes";
        datasetPolicies["f9a0d9d6637f30656b3fff0eabda549e31b3c7c19d3c561d78202acd0007e33e"] = "yes";
        datasetPolicies["2cc655c0e52c154b420bd4d48dae1140ffaa711104dfd7e6138d6e029a31f236"] = "yes";
        datasetPolicies["0ebfb9304766de83d71e222963e52ad59171ce520725b061a46d6b9ed58634e4"] = "yes";
    }}

    function getPolicy() public pure returns (string memory) {{
        return "personRole,specialization,designation,fromNetworks,grantId,department,experienceYears,certifications,researchFocus,authorizedBy";
    }}

    function evaluate(
        string memory datasetID,
        string[] memory inputs,
        string memory term0,string memory term1,string memory term2,string memory term3,string memory term4,string memory term5,
        bytes memory signature
    ) public {{
        // Verifying the Signature first:
        string memory concatenatedInputs = concatenateInputs(inputs, term0,term1,term2,term3,term4,term5);
        require(
            verify(
                publicKey,
                concatenatedInputs,
                signature
            ) == true,
            "Invalid signature"
        );

        string[] memory term_values = new string[](6);
        string[] memory term_hashes = new string[](6);
        (term_hashes[0], term_values[0]) = extractValueAndHash(term0);
        (term_hashes[1], term_values[1]) = extractValueAndHash(term1);
        (term_hashes[2], term_values[2]) = extractValueAndHash(term2);
        (term_hashes[3], term_values[3]) = extractValueAndHash(term3);
        (term_hashes[4], term_values[4]) = extractValueAndHash(term4);
        (term_hashes[5], term_values[5]) = extractValueAndHash(term5);

        // Policy Evaluation
        bool permit = evaluatePolicies(inputs, term_values, term_hashes);
        string memory decision = generateDecision(permit, datasetID, term_hashes, term_values);
        emit SignUpResult(decision);
    }}

    function concatenateInputs(string[] memory inputs, string memory term0,string memory term1,string memory term2,string memory term3,string memory term4,string memory term5) internal pure returns (string memory) {{
        string memory concatenatedInputs = "";
        for (uint i = 0; i < inputs.length; i++) {{
            if (i == 0) {{
                concatenatedInputs = inputs[i];
            }} else {{
                concatenatedInputs = string(abi.encodePacked(concatenatedInputs, ",", inputs[i]));
            }}
        }}
            concatenatedInputs = string(abi.encodePacked(concatenatedInputs, ",", term0));
            concatenatedInputs = string(abi.encodePacked(concatenatedInputs, ",", term1));
            concatenatedInputs = string(abi.encodePacked(concatenatedInputs, ",", term2));
            concatenatedInputs = string(abi.encodePacked(concatenatedInputs, ",", term3));
            concatenatedInputs = string(abi.encodePacked(concatenatedInputs, ",", term4));
            concatenatedInputs = string(abi.encodePacked(concatenatedInputs, ",", term5));
        return concatenatedInputs;
    }}

    function evaluatePolicies(
        string[] memory inputs,
        string[] memory term_values,
        string[] memory term_hashes
    ) internal view returns (bool) {{
        return checkArray(datasetPolicies["personRole"], inputs[0]) && checkArray(datasetPolicies["specialization"], inputs[1]) && checkArray(datasetPolicies["designation"], inputs[2]) && checkArray(datasetPolicies["fromNetworks"], inputs[3]) && keccak256(abi.encodePacked(datasetPolicies["grantId"])) == keccak256(abi.encodePacked(inputs[4])) && checkArray(datasetPolicies["department"], inputs[5]) && stringToUint(datasetPolicies["experienceYears"]) <= stringToUint(inputs[6]) && checkArray(datasetPolicies["certifications"], inputs[7]) && checkArray(datasetPolicies["researchFocus"], inputs[8]) && checkArray(datasetPolicies["authorizedBy"], inputs[9]) && keccak256(abi.encodePacked(datasetPolicies[term_hashes[0]])) == keccak256(abi.encodePacked(term_values[0])) && keccak256(abi.encodePacked(datasetPolicies[term_hashes[1]])) == keccak256(abi.encodePacked(term_values[1])) && keccak256(abi.encodePacked(datasetPolicies[term_hashes[2]])) == keccak256(abi.encodePacked(term_values[2])) && keccak256(abi.encodePacked(datasetPolicies[term_hashes[3]])) == keccak256(abi.encodePacked(term_values[3])) && keccak256(abi.encodePacked(datasetPolicies[term_hashes[4]])) == keccak256(abi.encodePacked(term_values[4])) && keccak256(abi.encodePacked(datasetPolicies[term_hashes[5]])) == keccak256(abi.encodePacked(term_values[5]));
    }}

    function generateDecision(
        bool permit,
        string memory datasetID,
        string[] memory term_hashes,
        string[] memory term_values
    ) internal view returns (string memory) {{
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

        if (!permit) {{
            string[] memory failedTerms = new string[](6);
            uint count = 0;
            for (uint i = 0; i < 6; i++) {{
                string memory term_hash = term_hashes[i];
                string memory term_value = term_values[i];
                if (keccak256(abi.encodePacked(datasetPolicies[term_hash])) != keccak256(abi.encodePacked(term_value))) {{
                    failedTerms[count] = term_hash;
                    count++;
                }}
            }}
            for (uint i = 0; i < count; i++) {{
                decision = string(abi.encodePacked(decision, " -- Failed Term: ", failedTerms[i]));
            }}
        }}

        return decision;
    }}

    function extractValueAndHash(string memory term) internal pure returns (string memory, string memory) {{
        bytes memory termBytes = bytes(term);
        uint colonIndex = 0;

        for (uint i = 0; i < termBytes.length; i++) {{
            if (termBytes[i] == ":") {{
                colonIndex = i;
                break;
            }}
        }}

        bytes memory valueBytes = new bytes(termBytes.length - colonIndex - 1);
        for (uint i = colonIndex + 1; i < termBytes.length; i++) {{
            valueBytes[i - colonIndex - 1] = termBytes[i];
        }}

        bytes memory hashBytes = new bytes(colonIndex);
        for (uint i = 0; i < colonIndex; i++) {{
            hashBytes[i] = termBytes[i];
        }}

        return (string(valueBytes), string(hashBytes));
    }}

    function checkArray(string memory arrayStr, string memory value) internal pure returns (bool) {{
        bytes memory arrayStrBytes = bytes(arrayStr);
        bytes memory valueBytes = bytes(value);
        bool found = false;
        uint start = 0;
        
        for (uint i = 0; i <= arrayStrBytes.length; i++) {{
            if (i == arrayStrBytes.length || arrayStrBytes[i] == ",") {{
                if (keccak256(abi.encodePacked(slice(arrayStrBytes, start, i - start))) == keccak256(abi.encodePacked(valueBytes))) {{
                    found = true;
                    break;
                }}
                start = i + 1;
            }}
        }}
        
        return found;
    }}

    function slice(bytes memory data, uint start, uint len) internal pure returns (bytes memory) {{
        bytes memory result = new bytes(len);
        for (uint i = 0; i < len; i++) {{
            result[i] = data[start + i];
        }}
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

    function getMessageHash(
        string memory _message
    ) public pure returns (bytes32) {{
        return keccak256(abi.encodePacked(_message));
    }}

    function getEthSignedMessageHash(
        bytes32 _messageHash
    ) public pure returns (bytes32) {{
        return
            keccak256(
                abi.encodePacked(
                    "\x19Ethereum Signed Message:\n32",
                    _messageHash
                )
            );
    }}

    function verify(
        address _signer,
        string memory _message,
        bytes memory signature
    ) public pure returns (bool) {{
        bytes32 messageHash = getMessageHash(_message);
        bytes32 ethSignedMessageHash = getEthSignedMessageHash(messageHash);

        return recoverSigner(ethSignedMessageHash, signature) == _signer;
    }}

    function recoverSigner(
        bytes32 _ethSignedMessageHash,
        bytes memory _signature
    ) public pure returns (address) {{
        (bytes32 r, bytes32 s, uint8 v) = splitSignature(_signature);

        return ecrecover(_ethSignedMessageHash, v, r, s);
    }}

    function splitSignature(
        bytes memory sig
    ) public pure returns (bytes32 r, bytes32 s, uint8 v) {{
        require(sig.length == 65, "invalid signature length");

        assembly {{
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }}
    }}

    function convert() public view returns (string memory) {{
        address addr = msg.sender;
        return toString(addr);
    }}

    function toString(address _addr) internal pure returns (string memory) {{
        bytes32 value = bytes32(uint256(uint160(_addr)));
        bytes memory alphabet = "0123456789abcdef";

        bytes memory str = new bytes(42);
        str[0] = '0';
        str[1] = 'x';

        for (uint256 i = 0; i < 20; i++) {{
            str[2 + i * 2] = alphabet[uint8(value[i + 12] >> 4)];
            str[3 + i * 2] = alphabet[uint8(value[i + 12] & 0x0f)];
        }}
        return string(str);
    }}
}
    