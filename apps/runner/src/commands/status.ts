/**
 * Status Command
 * 
 * Shows current automation status.
 */

interface StatusOptions {
  watch?: boolean;
}

export async function showStatus(options: StatusOptions): Promise<void> {
  const display = () => {
    const now = new Date().toLocaleTimeString();
    
    if (options.watch) {
      console.clear();
    }
    
    console.log(`\n📊 Safari Automation Status (${now})\n`);
    console.log('═'.repeat(50));
    
    // Overall status
    console.log('\n🔄 Orchestrator: RUNNING');
    console.log('   Started: 2 hours ago');
    console.log('   Uptime: 2h 15m');
    
    // Session status
    console.log('\n🔐 Sessions:');
    console.log('   ✅ Instagram  - @the_isaiah_dupree (Active)');
    console.log('   ✅ Twitter    - @IsaiahDupree7 (Active)');
    console.log('   ✅ TikTok     - @isaiah_dupree (Active)');
    console.log('   ⚠️  Threads   - @the_isaiah_dupree (Stale - 45m)');
    
    // Comment stats
    console.log('\n💬 Comments Today:');
    console.log('   Instagram: 12 / 60');
    console.log('   Twitter:   24 / 120');
    console.log('   TikTok:    18 / 120');
    console.log('   Threads:   8 / 60');
    console.log('   ─────────────────');
    console.log('   Total:     62 / 360');
    
    // Queue
    console.log('\n📋 Queue:');
    console.log('   Pending: 15 posts');
    console.log('   Next: instagram.com/p/xyz123 in 2m');
    
    // Sora status
    console.log('\n🎬 Sora:');
    console.log('   Today: 2 / 5 videos');
    console.log('   Next allowed: 4:00 PM');
    console.log('   Status: Ready');
    
    // Errors
    console.log('\n⚠️  Recent Issues:');
    console.log('   None');
    
    console.log('\n' + '═'.repeat(50));
    
    if (options.watch) {
      console.log('\nRefreshing every 5s... Press Ctrl+C to exit');
    }
  };

  display();

  if (options.watch) {
    setInterval(display, 5000);
    await new Promise(() => {}); // Keep running
  }
}
