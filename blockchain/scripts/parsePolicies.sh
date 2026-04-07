#!/bin/bash

## Step 1 : run the python File xacml-parser.py on each policies with extension .xml:
            # Goal : the file which we will pass it, it will create a contract with its name in the same directory.

## Step 2 : run the deploy.js 
            # Goal : Deploy the smartContract and store the smart Contract into schema of MongoDB

## Step 4 : run the 


# policy_dir="../policies"
policy_dir="../../backend/new_uploads"

contracts_dir="../contracts"

xml_files=("$policy_dir"/*.xml)

if [ ${#xml_files[@]} -eq 0 ]; then
  echo "No .xml files found in $policy_dir"
  exit 1
fi

for xml_file in "${xml_files[@]}"; do
  echo "Processing $xml_file..."
  python3 ../policies/array-receiving-contract.py "$xml_file" "$contracts_dir"
done


























