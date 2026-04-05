-- Seed the Daily Brief section (mirrors the Briefs view in Research.js).
-- Uses a passthrough render template: fetches the latest brief from Triton
-- and wraps its fields in the Brief card layout. No Claude call required.

insert into report_sections (name, description, kind, data_source, prompt_template, render_template, is_seed)
values (
  'Daily Brief',
  'The latest daily pitching brief from Triton, rendered with the standard Brief card layout.',
  'brief',
  '{"type": "triton_brief", "config": {}}'::jsonb,
  '',
  $render$<div style="margin-bottom:28px;padding:20px 24px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:12px;">
  <div style="margin-bottom:14px;">
    <h2 style="font-size:18px;font-weight:700;color:#ffffff;margin:0 0 6px 0;">{{brief_title}}</h2>
    <p style="font-size:13px;color:rgba(255,255,255,0.6);margin:0;line-height:1.5;">{{brief_summary}}</p>
    {{brief_badges}}
  </div>
  <div style="font-size:14px;color:rgba(255,255,255,0.75);line-height:1.7;">{{brief_content}}</div>
</div>$render$,
  true
)
on conflict do nothing;
