#!/bin/bash
# Test the Safari Automation Video API

set -e

API_URL="${API_URL:-http://localhost:7070}"
TEST_VIDEO="${1:-}"

echo "🧪 Testing Safari Automation Video API"
echo "   API URL: $API_URL"
echo ""

# Health check
echo "1️⃣  Health Check..."
HEALTH=$(curl -s "$API_URL/health")
echo "   $HEALTH"
echo ""

# Check if we have a test video
if [ -z "$TEST_VIDEO" ]; then
  echo "2️⃣  No test video provided. Creating a test with base64 placeholder..."
  
  # Submit with a small test request (will fail but tests the endpoint)
  RESPONSE=$(curl -s -X POST "$API_URL/api/v1/video/process" \
    -H "Content-Type: application/json" \
    -d '{
      "video_url": "https://example.com/test.mp4",
      "options": {
        "watermark_removal": {
          "enabled": true,
          "method": "auto",
          "platform": "sora"
        },
        "upscaling": {
          "enabled": true,
          "scale": 2
        },
        "encoding": {
          "codec": "hevc",
          "crf": 18
        }
      },
      "metadata": {
        "test": true,
        "source": "api-test"
      }
    }')
  
  echo "   Response: $RESPONSE"
  
  # Extract job ID
  JOB_ID=$(echo "$RESPONSE" | grep -o '"job_id":"[^"]*"' | cut -d'"' -f4)
  
  if [ -n "$JOB_ID" ]; then
    echo ""
    echo "3️⃣  Checking job status..."
    sleep 2
    JOB_STATUS=$(curl -s "$API_URL/api/v1/jobs/$JOB_ID")
    echo "   $JOB_STATUS"
  fi
else
  echo "2️⃣  Submitting video: $TEST_VIDEO"
  
  # Read video and encode as base64
  VIDEO_BASE64=$(base64 -i "$TEST_VIDEO")
  
  RESPONSE=$(curl -s -X POST "$API_URL/api/v1/video/process" \
    -H "Content-Type: application/json" \
    -d "{
      \"video_bytes\": \"$VIDEO_BASE64\",
      \"options\": {
        \"watermark_removal\": {
          \"enabled\": true,
          \"method\": \"auto\",
          \"platform\": \"sora\"
        },
        \"upscaling\": {
          \"enabled\": true,
          \"scale\": 2
        },
        \"encoding\": {
          \"codec\": \"hevc\",
          \"crf\": 18
        }
      },
      \"metadata\": {
        \"source\": \"api-test\",
        \"original_file\": \"$TEST_VIDEO\"
      }
    }")
  
  echo "   Response: $RESPONSE"
  
  JOB_ID=$(echo "$RESPONSE" | grep -o '"job_id":"[^"]*"' | cut -d'"' -f4)
  
  if [ -n "$JOB_ID" ]; then
    echo ""
    echo "3️⃣  Polling job status..."
    
    while true; do
      sleep 5
      JOB_STATUS=$(curl -s "$API_URL/api/v1/jobs/$JOB_ID")
      STATUS=$(echo "$JOB_STATUS" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
      PROGRESS=$(echo "$JOB_STATUS" | grep -o '"progress":[0-9]*' | cut -d':' -f2)
      STAGE=$(echo "$JOB_STATUS" | grep -o '"stage":"[^"]*"' | cut -d'"' -f4)
      
      echo "   [$PROGRESS%] $STAGE"
      
      if [ "$STATUS" = "completed" ]; then
        echo ""
        echo "✅ Job completed!"
        echo "   $JOB_STATUS"
        
        echo ""
        echo "4️⃣  Downloading result..."
        curl -s "$API_URL/api/v1/jobs/$JOB_ID/download" -o "processed_$JOB_ID.mp4"
        echo "   Saved to: processed_$JOB_ID.mp4"
        break
      elif [ "$STATUS" = "failed" ]; then
        echo ""
        echo "❌ Job failed!"
        echo "   $JOB_STATUS"
        break
      fi
    done
  fi
fi

echo ""
echo "✅ Test complete!"
