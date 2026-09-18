import {describe,expect,it} from 'vitest';
import {
  isPeerFloodMailingError,
  isRateLimitMailingError,
  mailingEmptyBatchDecision,
  mailingOkText,
  mailingTextPreview,
  parseMailingFloodWaitSec,
} from '@/lib/mailing';

describe('рассылка · flood / лог / очередь',()=>{
  it('отличает FloodWait от PEER_FLOOD',()=>{
    expect(isRateLimitMailingError('Too many requests')).toBe(true);
    expect(isRateLimitMailingError('FloodWaitError: A wait of 312 seconds is required')).toBe(true);
    expect(isRateLimitMailingError('PEER_FLOOD')).toBe(false);
    expect(isPeerFloodMailingError('PEER_FLOOD')).toBe(true);
    expect(isPeerFloodMailingError('spamblock')).toBe(true);
  });

  it('парсит секунды FloodWait',()=>{
    expect(parseMailingFloodWaitSec('FloodWait 312',900)).toBe(312);
    expect(parseMailingFloodWaitSec('A wait of 120 seconds is required',900)).toBe(120);
    expect(parseMailingFloodWaitSec('Too many requests',900)).toBeGreaterThanOrEqual(600);
  });

  it('не завершает задачу, пока есть отложенные получатели',()=>{
    const now=Date.parse('2026-09-18T08:35:00.000Z');
    const wait=mailingEmptyBatchDecision({
      'u:1':'2026-09-18T08:50:00.000Z',
      'u:2':'2026-09-18T08:40:00.000Z',
    },now);
    expect(wait.action).toBe('wait');
    if(wait.action==='wait'){
      expect(wait.nextAt).toBe('2026-09-18T08:40:00.000Z');
      expect(wait.waitSec).toBe(300);
    }
    expect(mailingEmptyBatchDecision({},now)).toEqual({action:'complete'});
    expect(mailingEmptyBatchDecision({'u:1':'2026-09-18T08:00:00.000Z'},now)).toEqual({action:'complete'});
  });

  it('в логе доставки показывает превью текста',()=>{
    expect(mailingTextPreview('  Привет   мир  ',80)).toBe('Привет мир');
    expect(mailingOkText('dana','','https://t.me/dana','Здравствуйте! Это тестовая рассылка UniLab')).toContain('«Здравствуйте! Это тестовая рассылка UniLab»');
    expect(mailingOkText('dana','1','','')).toBe('Доставлено @dana');
  });
});
