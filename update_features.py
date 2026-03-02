#!/usr/bin/env python3
"""Update feature list based on test results"""
import json

FEATURE_FILE = "/Users/isaiahdupree/Documents/Software/autonomous-coding-dashboard/harness/features/test-safari-linkedin.json"

# Features that are now passing based on test results
PASSING_FEATURES = [
    "T-SAFARI_LINKEDIN-014",  # Search LinkedIn profiles
    "T-SAFARI_LINKEDIN-017",  # Send LinkedIn message
    "T-SAFARI_LINKEDIN-018",  # Get LinkedIn connections list
    "T-SAFARI_LINKEDIN-019",  # Get LinkedIn DM conversations
    "T-SAFARI_LINKEDIN-020",  # AI-generate LinkedIn message
    "T-SAFARI_LINKEDIN-022",  # Get outreach stats
    "T-SAFARI_LINKEDIN-023",  # Get pending connection requests
    "T-SAFARI_LINKEDIN-024",  # Get LinkedIn rate limits
    "T-SAFARI_LINKEDIN-025",  # Navigate to LinkedIn profile
    "T-SAFARI_LINKEDIN-026",  # Run outreach campaign
    "T-SAFARI_LINKEDIN-027",  # Score prospect with ICP criteria
    "T-SAFARI_LINKEDIN-029",  # Search with filters
    "T-SAFARI_LINKEDIN-033",  # Check active hours guard
    "T-SAFARI_LINKEDIN-059",  # LinkedIn rate limit headers
    "T-SAFARI_LINKEDIN-076",  # AI message generation returns string
]

def main():
    with open(FEATURE_FILE, 'r') as f:
        data = json.load(f)

    updated_count = 0
    for feature in data['features']:
        if feature['id'] in PASSING_FEATURES:
            if not feature['passes']:
                feature['passes'] = True
                feature['status'] = 'completed'
                updated_count += 1
                print(f"✓ Updated {feature['id']}: {feature['name']}")

    with open(FEATURE_FILE, 'w') as f:
        json.dump(data, f, indent=2)

    # Count totals
    total = len(data['features'])
    passing = sum(1 for f in data['features'] if f['passes'])
    print(f"\nTotal features: {total}")
    print(f"Passing: {passing} ({100*passing/total:.1f}%)")
    print(f"Updated: {updated_count}")

if __name__ == '__main__':
    main()
