import { describe, expect, it } from 'vitest';
import { addAnnotation, addStep, createBuiltInFormations, createProject, passBall } from '@btl/tactic-engine';
import { buildExportBundle, parseExportJson } from '../src';

describe('JSON 匯入匯出', () => {
  it('戰術與隊形可往返（round-trip）', () => {
    let p = addStep(createProject({ title: '傳切' }), 0);
    p = passBall(p, 1, 'red-2');
    p = addAnnotation(p, 1, { kind: 'screen', color: '#222', points: [{ x: 20, y: 5 }, { x: 21, y: 6 }] });
    const forms = createBuiltInFormations();
    const text = JSON.stringify(buildExportBundle(p, forms));
    const r = parseExportJson(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.project).toEqual(p);
    expect(r.value.formations).toEqual(forms);
  });

  it('匯出內含規格要求欄位', () => {
    const b = buildExportBundle(createProject(), undefined) as unknown as Record<string, unknown>;
    expect(b.schemaVersion).toBe(1);
    const proj = b.project as Record<string, unknown>;
    for (const k of ['court', 'teams', 'players', 'steps']) expect(proj).toHaveProperty(k);
    expect(proj.court).toMatchObject({ mode: 'half', lengthM: 28, widthM: 15, attackDirection: 'right' });
    expect(b.ball).toMatchObject({ holderId: 'red-1' });
  });

  it('拒絕非 JSON、錯誤格式、未知版本與壞資料', () => {
    expect(parseExportJson('not json').ok).toBe(false);
    expect(parseExportJson('{"hello":1}').ok).toBe(false);
    const future = { format: 'basketball-tactics-lab', schemaVersion: 99, exportedAt: '', formations: [] };
    const r = parseExportJson(JSON.stringify(future));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/不支援/);

    const p = createProject();
    const broken = JSON.parse(JSON.stringify(p));
    delete broken.steps[0].players['blue-2'];
    const r2 = parseExportJson(JSON.stringify(buildExportBundle(broken, undefined)));
    expect(r2.ok).toBe(false);

    const dup = JSON.parse(JSON.stringify(p));
    dup.players[1].jerseyNumber = 1;
    expect(parseExportJson(JSON.stringify(buildExportBundle(dup, undefined))).ok).toBe(false);
  });
});
