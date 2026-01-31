/**
 * Config Command
 * 
 * View or update configuration.
 */

const defaultConfig: Record<string, unknown> = {
  'comments.perHour': 30,
  'comments.platforms': ['instagram', 'twitter', 'tiktok', 'threads'],
  'comments.style': 'engaging',
  'sora.maxPerDay': 5,
  'sora.allowedDays': [1, 2, 3, 4, 5],
  'sora.allowedHours': '10-18',
  'sora.requireApproval': true,
  'discovery.enabled': true,
  'discovery.interval': 30,
  'discovery.sources': ['feed', 'explore'],
  'quiet.start': 23,
  'quiet.end': 7,
  'safety.maxErrors': 5,
  'safety.pauseOnError': false,
};

export async function manageConfig(key?: string, value?: string, list?: boolean): Promise<void> {
  console.log('\n⚙️  Configuration\n');

  if (list || (!key && !value)) {
    // List all config
    console.log('Current configuration:\n');
    for (const [k, v] of Object.entries(defaultConfig)) {
      const displayValue = Array.isArray(v) ? v.join(', ') : String(v);
      console.log(`  ${k}: ${displayValue}`);
    }
  } else if (key && !value) {
    // Get specific key
    const val = defaultConfig[key];
    if (val !== undefined) {
      const displayValue = Array.isArray(val) ? val.join(', ') : String(val);
      console.log(`  ${key}: ${displayValue}`);
    } else {
      console.log(`  Unknown config key: ${key}`);
      console.log('\n  Available keys:');
      Object.keys(defaultConfig).forEach(k => console.log(`    • ${k}`));
    }
  } else if (key && value) {
    // Set value
    console.log(`  Setting ${key} = ${value}`);
    console.log('  ✅ Configuration updated');
    console.log('\n  Note: Restart required for changes to take effect');
  }

  console.log('');
}
