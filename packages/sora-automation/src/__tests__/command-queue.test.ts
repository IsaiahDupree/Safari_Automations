/**
 * Unit tests for the command queue — no Safari required.
 */

import { queue } from '../automation/command-queue.js';

describe('CommandQueue', () => {
  test('enqueue creates PENDING command', () => {
    const cmd = queue.enqueue('sora.generate', { prompt: 'test prompt' });
    expect(cmd.id).toBeTruthy();
    expect(cmd.status).toBe('PENDING');
    expect(cmd.type).toBe('sora.generate');
    expect(cmd.payload.prompt).toBe('test prompt');
  });

  test('get returns the command', () => {
    const cmd = queue.enqueue('sora.clean', { video_path: '/tmp/test.mp4' });
    const found = queue.get(cmd.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(cmd.id);
  });

  test('markRunning sets status and startedAt', () => {
    const cmd = queue.enqueue('sora.generate', { prompt: 'x' });
    queue.markRunning(cmd.id);
    const updated = queue.get(cmd.id)!;
    expect(updated.status).toBe('RUNNING');
    expect(updated.startedAt).toBeTruthy();
  });

  test('markSucceeded sets result', () => {
    const cmd = queue.enqueue('sora.generate.clean', { prompt: 'y' });
    queue.markRunning(cmd.id);
    queue.markSucceeded(cmd.id, { video_path: '/tmp/out.mp4', cleaned_path: '/tmp/cleaned.mp4' });
    const done = queue.get(cmd.id)!;
    expect(done.status).toBe('SUCCEEDED');
    expect(done.result?.cleaned_path).toBe('/tmp/cleaned.mp4');
    expect(done.completedAt).toBeTruthy();
  });

  test('markFailed sets error', () => {
    const cmd = queue.enqueue('sora.generate', { prompt: 'z' });
    queue.markRunning(cmd.id);
    queue.markFailed(cmd.id, 'something went wrong');
    const failed = queue.get(cmd.id)!;
    expect(failed.status).toBe('FAILED');
    expect(failed.error).toBe('something went wrong');
  });

  test('cancel works on PENDING, not on RUNNING', () => {
    const cmd = queue.enqueue('sora.generate', { prompt: 'a' });
    const cancelled = queue.cancel(cmd.id);
    expect(cancelled).toBe(true);
    expect(queue.get(cmd.id)!.status).toBe('CANCELLED');

    const cmd2 = queue.enqueue('sora.generate', { prompt: 'b' });
    queue.markRunning(cmd2.id);
    const notCancelled = queue.cancel(cmd2.id);
    expect(notCancelled).toBe(false);
    expect(queue.get(cmd2.id)!.status).toBe('RUNNING');
  });

  test('list returns commands sorted newest first', () => {
    const a = queue.enqueue('sora.generate', { prompt: 'first' });
    const b = queue.enqueue('sora.clean', { video_path: '/tmp/x.mp4' });
    const list = queue.list();
    const ids = list.map(c => c.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
  });
});
