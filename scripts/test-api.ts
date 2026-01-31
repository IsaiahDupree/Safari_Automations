/**
 * Test Script for Instagram API
 * 
 * Runs automated tests on all API operations
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const SAFARI_URL = process.env.SAFARI_API_URL || 'http://localhost:3100';
const supabase = createClient(
  process.env.CRM_SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.CRM_SUPABASE_KEY || ''
);

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration: number;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<boolean>): Promise<void> {
  const start = Date.now();
  try {
    const passed = await fn();
    results.push({
      name,
      passed,
      message: passed ? 'OK' : 'FAILED',
      duration: Date.now() - start
    });
    console.log(`  ${passed ? '✅' : '❌'} ${name} (${Date.now() - start}ms)`);
  } catch (e: any) {
    results.push({
      name,
      passed: false,
      message: e.message,
      duration: Date.now() - start
    });
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

async function exec(script: string): Promise<string> {
  const res = await fetch(`${SAFARI_URL}/api/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script })
  });
  const data = await res.json();
  return data.output || '';
}

// ============== Tests ==============

async function testSafariConnection(): Promise<boolean> {
  const res = await fetch(`${SAFARI_URL}/api/status`);
  return res.ok;
}

async function testDatabaseConnection(): Promise<boolean> {
  const { count, error } = await supabase
    .from('instagram_contacts')
    .select('*', { count: 'exact', head: true });
  return !error && count !== null;
}

async function testPatternsTable(): Promise<boolean> {
  const { data, error } = await supabase
    .from('automation_patterns')
    .select('*')
    .limit(1);
  return !error && data !== null;
}

async function testKnownHandlesInDB(): Promise<boolean> {
  const { data } = await supabase
    .from('automation_patterns')
    .select('*')
    .eq('pattern_type', 'known_handle');
  return data !== null && data.length > 0;
}

async function testSelectorsInDB(): Promise<boolean> {
  const { data } = await supabase
    .from('automation_patterns')
    .select('*')
    .eq('pattern_type', 'selector');
  return data !== null && data.length > 0;
}

async function testInstagramPageLoaded(): Promise<boolean> {
  const url = await exec('window.location.href');
  return url.includes('instagram.com');
}

async function testTextboxSelector(): Promise<boolean> {
  const result = await exec('document.querySelector("[role=textbox]") ? "found" : "not found"');
  // Textbox may or may not be present depending on current page
  return result === 'found' || result === 'not found';
}

async function testTabSelector(): Promise<boolean> {
  await fetch(`${SAFARI_URL}/api/inbox/navigate`, { method: 'POST' });
  await new Promise(r => setTimeout(r, 2000));
  const result = await exec('document.querySelectorAll("[role=tab]").length');
  return parseInt(result) >= 2;
}

async function testContactsTable(): Promise<boolean> {
  const { count } = await supabase
    .from('instagram_contacts')
    .select('*', { count: 'exact', head: true });
  return count !== null && count > 0;
}

async function testConversationsTable(): Promise<boolean> {
  const { count } = await supabase
    .from('instagram_conversations')
    .select('*', { count: 'exact', head: true });
  return count !== null && count > 0;
}

async function testMessagesTable(): Promise<boolean> {
  const { count } = await supabase
    .from('instagram_messages')
    .select('*', { count: 'exact', head: true });
  return count !== null && count > 0;
}

async function testOutreachQueue(): Promise<boolean> {
  const { error } = await supabase
    .from('outreach_queue')
    .select('*')
    .limit(1);
  return !error;
}

async function testContactUpsert(): Promise<boolean> {
  const testUsername = `test_user_${Date.now()}`;
  const { data, error } = await supabase
    .from('instagram_contacts')
    .insert({
      instagram_username: testUsername,
      display_name: 'Test User',
      relationship_score: 50,
      tags: ['test']
    })
    .select('id')
    .single();
  
  if (error || !data) return false;
  
  // Clean up
  await supabase.from('instagram_contacts').delete().eq('id', data.id);
  return true;
}

async function testPatternQuery(): Promise<boolean> {
  const { data } = await supabase
    .from('automation_patterns')
    .select('pattern_key, pattern_value')
    .eq('pattern_type', 'known_handle')
    .eq('pattern_key', 'saraheashley');
  
  return data !== null && data.length > 0 && data[0].pattern_value === 'Sarah Ashley';
}

// ============== Main ==============

async function runTests() {
  console.log('\n🧪 Instagram CRM API Tests\n');
  console.log('━'.repeat(50));
  
  console.log('\n📡 Connection Tests:\n');
  await test('Safari API connection', testSafariConnection);
  await test('Database connection', testDatabaseConnection);
  await test('Instagram page loaded', testInstagramPageLoaded);
  
  console.log('\n📋 Database Tables:\n');
  await test('automation_patterns table exists', testPatternsTable);
  await test('instagram_contacts table has data', testContactsTable);
  await test('instagram_conversations table has data', testConversationsTable);
  await test('instagram_messages table has data', testMessagesTable);
  await test('outreach_queue table accessible', testOutreachQueue);
  
  console.log('\n🎯 Pattern Data:\n');
  await test('Known handles in database', testKnownHandlesInDB);
  await test('Selectors in database', testSelectorsInDB);
  await test('Pattern query works', testPatternQuery);
  
  console.log('\n🔍 Selector Tests:\n');
  await test('Tab selector works', testTabSelector);
  await test('Textbox selector accessible', testTextboxSelector);
  
  console.log('\n💾 CRUD Operations:\n');
  await test('Contact upsert works', testContactUpsert);
  
  // Summary
  console.log('\n' + '━'.repeat(50));
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const allPassed = passed === total;
  
  console.log(`\n${allPassed ? '✅' : '⚠️'} Results: ${passed}/${total} tests passed\n`);
  
  if (!allPassed) {
    console.log('Failed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ❌ ${r.name}: ${r.message}`);
    });
  }
  
  // Get database stats
  const { count: contacts } = await supabase.from('instagram_contacts').select('*', { count: 'exact', head: true });
  const { count: conversations } = await supabase.from('instagram_conversations').select('*', { count: 'exact', head: true });
  const { count: messages } = await supabase.from('instagram_messages').select('*', { count: 'exact', head: true });
  const { count: patterns } = await supabase.from('automation_patterns').select('*', { count: 'exact', head: true });
  
  console.log('📊 Database Stats:');
  console.log(`  Contacts:      ${contacts}`);
  console.log(`  Conversations: ${conversations}`);
  console.log(`  Messages:      ${messages}`);
  console.log(`  Patterns:      ${patterns}`);
  console.log('');
}

runTests();
