

// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.4.22 <0.9.0;

import "@openzeppelin/contracts/utils/Strings.sol";

contract SC_20_21_13_28 {
    using Strings for uint256;

    address public constant publicKey =
        0x7264d9Fd1a56D865D8B7D96E5251A6eFE820b483;

    event SignUpResult(string success);

    // Store dataset-specific access control policies
    mapping(string => string) datasetPolicies;

    constructor() {{
        datasetPolicies["grantId"] = "grant123";
        datasetPolicies["experienceYears"] = "3";
        datasetPolicies["personRole"] = "oncologist,researcher,phd-student,clinical-researcher,medical-scientist";
        datasetPolicies["specialization"] = "lung-cancer,cancer,medical-research,bioinformatics,biomedical-engineering";
        datasetPolicies["designation"] = "doctor,researcher,phd-student,clinician,postdoctoral-fellow";
        datasetPolicies["fromNetworks"] = "hospital-network,university-network,research-institute-network";
        datasetPolicies["department"] = "oncology,biology,computer-science,bioinformatics,biomedical-engineering";
        datasetPolicies["certifications"] = "PhD,board-certified,fellowship-trained,certified-clinical-researcher";
        datasetPolicies["researchFocus"] = "oncology,biology,computer-science,bioinformatics,biomedical-engineering";
        datasetPolicies["authorizedBy"] = "faculty-advisor,administrator,department-head,hospital-administrator,project-director,research-institute-director";
        datasetPolicies["1f954a98ad7ec195cd74c8f5e6a268719907a7412b9f7c6236018f7674106187"] = "yes";
        datasetPolicies["73b6b416117576871ec738f701d8238d6e9456effb559aee9493443237ff313c"] = "yes";
        datasetPolicies["534188b4ae6cba92139b0ef24e4a89c2bb400a7d08e855e488fda865736b6a1a"] = "yes";
    }}

    function getPolicy() public pure returns (string memory) {{
        return "personRole,specialization,designation,fromNetworks,grantId,department,experienceYears,certifications,researchFocus,authorizedBy";
    }}

    function evaluate(
        string memory datasetID,
        string memory personRole, string memory specialization, string memory designation, string memory fromNetworks, string memory grantId, string memory department, string memory experienceYears, string memory certifications, string memory researchFocus, string memory authorizedBy, string memory term0, string memory term1, string memory term2,
        bytes memory signature
    ) public {{
        // Verifying the Signature first:
        require(
            verify(
                publicKey,
                string(
                    abi.encodePacked(
                        personRole, ", ", specialization, ", ", designation, ", ", fromNetworks, ", ", grantId, ", ", department, ", ", experienceYears, ", ", certifications, ", ", researchFocus, ", ", authorizedBy, ", ", term0, ", ", term1, ", ", term2
                    )
                ),
                signature
            ) == true,
            "Invalid signature"
        );

        string[] memory term_hashes = new string[](3);
        term_hashes[0] = keccak256(abi.encodePacked(term0.split(":")[1]));
        term_hashes[1] = keccak256(abi.encodePacked(term1.split(":")[1]));
        term_hashes[2] = keccak256(abi.encodePacked(term2.split(":")[1]));

        // Policy Evaluation
        bool permit = checkArray(datasetPolicies["personRole"], personRole) && checkArray(datasetPolicies["specialization"], specialization) && checkArray(datasetPolicies["designation"], designation) && checkArray(datasetPolicies["fromNetworks"], fromNetworks) && keccak256(abi.encodePacked(datasetPolicies["grantId"])) == keccak256(abi.encodePacked(grantId)) && checkArray(datasetPolicies["department"], department) && keccak256(abi.encodePacked(datasetPolicies["experienceYears"])) == keccak256(abi.encodePacked(experienceYears)) && checkArray(datasetPolicies["certifications"], certifications) && checkArray(datasetPolicies["researchFocus"], researchFocus) && checkArray(datasetPolicies["authorizedBy"], authorizedBy) && keccak256(abi.encodePacked(datasetPolicies[term_hashes[0]])) == keccak256(abi.encodePacked("yes")) && keccak256(abi.encodePacked(datasetPolicies[term_hashes[1]])) == keccak256(abi.encodePacked("yes")) && keccak256(abi.encodePacked(datasetPolicies[term_hashes[2]])) == keccak256(abi.encodePacked("yes"));

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

        // Check the hashes and their conditions
        if (!permit) {{
            string[] memory failedTerms = new string[](3);
            uint count = 0;
            for (uint i = 0; i < 3; i++) {{
                string memory term_hash = term_hashes[i];
                if (keccak256(abi.encodePacked(datasetPolicies[term_hash])) != keccak256(abi.encodePacked("yes"))) {{
                    failedTerms[count] = term_hash;
                    count++;
                }}
            }}
            for (uint i = 0; i < count; i++) {{
                decision = string(abi.encodePacked(decision, " -- Failed Term: ", failedTerms[i]));
            }}
        }}

        emit SignUpResult(decision);
    }}

    function checkArray(string memory arrayStr, string memory value) internal pure returns (bool) {{
        strings.slice memory s = arrayStr.toSlice();
        strings.slice memory delim = ",".toSlice();
        strings.slice memory item;
        for (uint i = 0; i < s.count(delim) + 1; i++) {{
            item = s.split(delim);
            if (keccak256(abi.encodePacked(item.toString())) == keccak256(abi.encodePacked(value))) {{
                return true;
            }}
        }}
        return false;
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
    
