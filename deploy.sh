#!/usr/bin/env bash
set -euo pipefail

echo "=== ScamShield Bot — Railway Deployment ==="

# Check Railway CLI
if ! command -v railway &> /dev/null; then
  echo "Railway CLI not found. Install it:"
  echo "  npm install -g @railway/cli"
  exit 1
fi

# Check login
if ! railway whoami &> /dev/null; then
  echo "Not logged in to Railway. Running login..."
  railway login
fi

# Link to project (if not already linked)
if [ ! -f ".railway/config.json" ]; then
  echo "No Railway project linked. Linking now..."
  railway link
fi

echo ""
echo "Setting environment variables..."
echo "Make sure your .env file exists with all required values."
echo ""

if [ -f .env ]; then
  read -p "Load variables from .env to Railway? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    while IFS='=' read -r key value; do
      # Skip comments and empty lines
      [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
      # Strip quotes from value
      value="${value%\"}"
      value="${value#\"}"
      echo "  Setting $key..."
      railway variables set "$key=$value"
    done < .env
    echo "Environment variables set."
  fi
else
  echo "No .env file found. Set variables manually with:"
  echo "  railway variables set KEY=value"
fi

echo ""
echo "Deploying to Railway..."
railway up --detach

echo ""
echo "Deployment initiated!"
echo ""
echo "After deployment completes:"
echo "1. Get your Railway URL: railway domain"
echo "2. Set WEBHOOK_URL to your Railway URL"
echo "3. Set BOT_MODE=webhook"
echo ""
echo "Done!"
