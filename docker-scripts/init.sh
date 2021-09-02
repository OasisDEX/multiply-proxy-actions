#!/usr/bin/env bash
set -m
# Running the hardhat node in background
npx hardhat node --max-memory 8192 &

# Wait a little bit to be sure the node is started
sleep 2

# This captures the terminate signal ( Ctrl ^ C ) 
# and terminates any process started from this shell
trap "exit" INT TERM ERR
trap "jobs -p | xargs -r kill" EXIT

# Deploy the system contracts
npx hardhat run scripts/deploy-system.js --network local

# Move the hardhat node to foreground
fg %1

