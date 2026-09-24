import { describe, it, expect } from 'vitest';
import {
  formatClock, formatDuration, formatGap, formatDateBR, formatDateTimeBR, parseClockInput,
  brasiliaOffsetMinutes, excelSerialBrasilia, excelDuration, formatPace, parseDateInput,
} from './format';

const T = Date.parse('2026-10-11T11:00:05.345Z'); // 08:00:05.345 in Brasília (UTC-3)

describe('format (independent of device time zone)', () => {
  it('formats the clock in Brasília', () => {
    expect(formatClock(T)).toBe('08:00:05');
    expect(formatClock(T, { tenths: true })).toBe('08:00:05.3');
    expect(formatClock(T, { millis: true })).toBe('08:00:05.345');
  });
  it('Brasília offset is -180 minutes in 2026', () => {
    expect(brasiliaOffsetMinutes(T)).toBe(-180);
  });
  it('formats durations (truncating)', () => {
    expect(formatDuration(3_723_456)).toBe('1:02:03');
    expect(formatDuration(3_723_456, { tenths: true })).toBe('1:02:03.4');
    expect(formatDuration(2_527_000)).toBe('42:07');
    expect(formatDuration(59_999)).toBe('0:59');
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(-65_000)).toBe('-1:05');
  });
  it('formats gaps', () => {
    expect(formatGap(0)).toBe('');
    expect(formatGap(null)).toBe('');
    expect(formatGap(65_000)).toBe('+1:05');
  });
  it('formats dates', () => {
    expect(formatDateBR('2026-10-11')).toBe('11/10/2026');
    expect(formatDateTimeBR(T)).toBe('11/10/2026 08:00:05');
  });
  it('parses clock input as Brasília wall time on the event date', () => {
    expect(parseClockInput('08:00:05.3', '2026-10-11')).toBe(Date.parse('2026-10-11T11:00:05.300Z'));
    expect(parseClockInput('8:00', '2026-10-11')).toBe(Date.parse('2026-10-11T11:00:00.000Z'));
    expect(parseClockInput('08:00:05,25', '2026-10-11')).toBe(Date.parse('2026-10-11T11:00:05.250Z'));
    expect(parseClockInput('25:00', '2026-10-11')).toBeNull();
    expect(parseClockInput('08:61', '2026-10-11')).toBeNull();
    expect(parseClockInput('abc', '2026-10-11')).toBeNull();
  });
  it('produces Excel serials in Brasília local time', () => {
    const expected = Date.UTC(2026, 9, 11, 8, 0, 5, 345) / 86_400_000 + 25569;
    expect(excelSerialBrasilia(T)).toBeCloseTo(expected, 9);
    expect(excelDuration(86_400_000)).toBe(1);
  });
  it('formats pace per modality', () => {
    expect(formatPace(22 * 60_000 + 30_000, 5000, 'run')).toBe('4:30 /km');
    expect(formatPace(12 * 60_000 + 30_000, 750, 'swim')).toBe('1:40 /100m');
    expect(formatPace(37 * 60_000, 20_000, 'bike')).toBe('32,4 km/h');
    expect(formatPace(60_000, 0, 'run')).toBe('');
    expect(formatPace(60_000, 100, 'other')).toBe('');
  });
  it('parses dates typed in Brazilian or ISO format', () => {
    expect(parseDateInput('15/06/1990')).toBe('1990-06-15');
    expect(parseDateInput('5/6/1990')).toBe('1990-06-05');
    expect(parseDateInput('1990-06-15')).toBe('1990-06-15');
    expect(parseDateInput('31/02/1990')).toBeNull();
    expect(parseDateInput('')).toBeNull();
  });
});
