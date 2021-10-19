#!/usr/bin/env bash
set -m
# Running the hardhat node in background
npx hardhat node --max-memory 8192 &

# Wait a little bit to be sure the node is started
sleep 2

# Deploy the system contracts
npx hardhat run scripts/deploy-system.js --network local

# Move the hardhat node to foreground
fg %1

