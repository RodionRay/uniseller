import {describe,expect,it} from 'vitest';
import {workerFunnelText} from '@/lib/scan-funnel';

describe('workerFunnelText: worker counters in the scan log',()=>{
  it('renders read / stop / no-keywords / not-a-user counters',()=>{
    expect(workerFunnelText({fetched:120,skippedMinus:80,skippedKw:30,skippedNotUser:2}))
      .toBe('прочитано 120 · стоп 80 · нет ключей 30 · не люди 2');
  });

  it('shows zero counters when the worker read nothing',()=>{
    expect(workerFunnelText({fetched:0,skippedMinus:0,skippedKw:0,skippedNotUser:0}))
      .toBe('прочитано 0 · стоп 0 · нет ключей 0 · не люди 0');
  });

  it('is empty for an older worker without counters',()=>{
    expect(workerFunnelText({})).toBe('');
  });

  it('ignores non-numeric counters',()=>{
    expect(workerFunnelText({fetched:'12',skippedMinus:'x'})).toBe('прочитано 12 · стоп 0 · нет ключей 0 · не люди 0');
  });
});
