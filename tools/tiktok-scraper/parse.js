// Flatten output/raw/*data-insight*.json captures into one clean per-video CSV.
//
// Run after a capture session:  npm run parse
// Merges all payloads per video (latest non-null wins) and computes Ashley's
// scorecard: hook/hold (finish %, watch time), amplify (shares+saves per 1k),
// convert (new followers per 1k), plus distribution splits and demographics.
//
// Output: output/videos-<runstamp>.csv + a summary table on stdout.

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'output');
const RAW_DIR = path.join(OUT_DIR, 'raw');
const RUNSTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const CSV_PATH = path.join(OUT_DIR, `videos-${RUNSTAMP}.csv`);

// TikTok wraps values in nested {value: {value: ...}} envelopes (sometimes with
// is_after_7d/is_data_delay flags). Descend until we hit the real payload.
function unwrap(x) {
  while (x && typeof x === 'object' && !Array.isArray(x) && 'value' in x) x = x.value;
  return x;
}

const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
const pct = (x) => (num(x) === null ? null : Math.round(x * 1000) / 10); // 0.135 -> 13.5

// {key,value} arrays (traffic sources, gender, age) -> {key: value}
function kvMap(x) {
  const arr = unwrap(x);
  if (!Array.isArray(arr)) return {};
  const out = {};
  for (const e of arr) if (e && e.key != null) out[e.key] = num(e.value);
  return out;
}

const videos = {};

const files = fs.existsSync(RAW_DIR)
  ? fs.readdirSync(RAW_DIR).filter((f) => f.includes('data-insight') && f.endsWith('.json')).sort()
  : [];

for (const f of files) {
  let body, url;
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(RAW_DIR, f)));
    body = saved.body || {};
    url = saved.url || '';
  } catch { continue; }
  const vi = body.video_info || {};
  // Viewers-tab requests carry the video id only in the URL's type_requests param.
  const urlId = (decodeURIComponent(url).match(/"aweme_id"\s*:\s*"(\d+)"/) || [])[1];
  const id = vi.item_id || vi.aweme_id || (body.extra && body.extra.item_id) || urlId;
  if (!id) continue;
  const v = (videos[id] = videos[id] || { item_id: id });
  const set = (key, val) => { if (val !== null && val !== undefined && val !== '') v[key] = val; };

  set('title', (vi.item_title || vi.desc || '').replace(/\s+/g, ' ').trim());
  if (vi.create_time) set('posted', new Date(vi.create_time * 1000).toISOString().slice(0, 10));
  if (vi.video && vi.video.duration) set('duration_s', Math.round(vi.video.duration / 1000));

  const st = vi.statistics || {};
  set('views', num(st.play_count));
  set('likes', num(st.digg_count));
  set('comments', num(st.comment_count));
  set('shares', num(st.share_count));
  set('saves', num(st.collect_count));

  // Hold
  const finish = body.realtime_finish_rate_history || body.video_finish_rate_history_7d;
  if (finish && finish.total != null) set('finish_rate_pct', pct(finish.total));
  const watch = body.realtime_average_watch_time_history;
  if (watch && watch.total != null) set('avg_watch_s', Math.round(watch.total * 10) / 10);

  // Reach / convert
  const reached = body.reached_audience_history;
  if (reached && reached.total != null) set('reached_audience', num(reached.total));
  set('unique_viewers', num(unwrap(body.unique_viewer_num)));
  const nf = body.realtime_new_followers || body.video_new_followers_history_7d;
  if (nf && nf.total != null) set('new_followers', num(nf.total));

  // Distribution splits (Viewers tab)
  set('follower_view_pct', pct(unwrap(body.video_viewer_follower_percent_realtime || body.video_viewer_follower_percent)));
  set('nonfollower_view_pct', pct(unwrap(body.video_viewer_nonfollower_percent_realtime || body.video_viewer_non_follower_percent)));
  set('new_viewer_pct', pct(unwrap(body.video_viewer_new_viewer_percent)));
  set('returning_viewer_pct', pct(unwrap(body.video_viewer_return_viewer_percent)));

  // Traffic sources
  const ts = kvMap(body.video_traffic_source_percent_realtime);
  set('traffic_fyp_pct', pct(ts['For You']));
  set('traffic_follow_pct', pct(ts['Follow']));
  set('traffic_search_pct', pct(ts['Search']));
  set('traffic_profile_pct', pct(ts['Personal Profile']));
  set('traffic_sound_pct', pct(ts['Sound']));

  // Demographics (Viewers tab)
  const gender = kvMap(body.video_viewer_gender_percent_realtime);
  set('male_pct', pct(gender.male_vv));
  set('female_pct', pct(gender.female_vv));
  const age = kvMap(body.video_viewer_age_percent_realtime);
  const topAge = Object.entries(age).sort((a, b) => (b[1] || 0) - (a[1] || 0))[0];
  if (topAge) set('top_age', `${topAge[0]} (${pct(topAge[1])}%)`);
  const loc = unwrap(body.video_viewer_location_percent_realtime);
  const us = loc && Array.isArray(loc.country_percent_list)
    ? loc.country_percent_list.find((c) => c.country_name === 'US') : null;
  if (us) set('us_pct', pct(us.country_vv_percent));

  if (Array.isArray(body.item_search_terms) && body.item_search_terms.length) {
    set('search_terms', body.item_search_terms.map((t) => t.keyword || t.key || t).slice(0, 5).join('; '));
  }
}

// Derived scorecard fields
for (const v of Object.values(videos)) {
  // unique_viewer_num sometimes arrives account-level (weekly viewers), not per-video;
  // a per-video unique count can never exceed the video's views.
  if (v.unique_viewers != null && v.views != null && v.unique_viewers > v.views) delete v.unique_viewers;
  if (v.views) {
    if (v.duration_s && v.avg_watch_s) v.watch_pct_of_video = Math.round((v.avg_watch_s / v.duration_s) * 1000) / 10;
    if (v.unique_viewers) v.rewatch_ratio = Math.round((v.views / v.unique_viewers) * 100) / 100;
    const amplify = (v.shares || 0) + (v.saves || 0);
    v.amplify_per_1k = Math.round((amplify / v.views) * 10000) / 10;
    if (v.new_followers != null) v.follows_per_1k = Math.round((v.new_followers / v.views) * 10000) / 10;
    const eng = (v.likes || 0) + (v.comments || 0) + amplify;
    v.engagement_rate_pct = Math.round((eng / v.views) * 1000) / 10;
  }
}

const COLS = [
  'item_id', 'title', 'posted', 'duration_s',
  'views', 'unique_viewers', 'rewatch_ratio', 'reached_audience',
  'finish_rate_pct', 'avg_watch_s', 'watch_pct_of_video',
  'likes', 'comments', 'shares', 'saves', 'engagement_rate_pct', 'amplify_per_1k',
  'new_followers', 'follows_per_1k',
  'follower_view_pct', 'nonfollower_view_pct', 'new_viewer_pct', 'returning_viewer_pct',
  'traffic_fyp_pct', 'traffic_follow_pct', 'traffic_search_pct', 'traffic_profile_pct', 'traffic_sound_pct',
  'male_pct', 'female_pct', 'top_age', 'us_pct', 'search_terms',
];

const rows = Object.values(videos).sort((a, b) => (b.views || 0) - (a.views || 0));
if (!rows.length) {
  console.log('No per-video payloads found in output/raw/. Run a capture session first.');
  process.exit(1);
}

const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
fs.writeFileSync(CSV_PATH, [COLS.join(',')].concat(rows.map((r) => COLS.map((c) => esc(r[c])).join(','))).join('\n'));

console.log(`${rows.length} videos → ${path.relative(__dirname, CSV_PATH)}\n`);
for (const r of rows) {
  console.log(
    `${String(r.views ?? '?').padStart(7)} views · finish ${r.finish_rate_pct ?? '—'}% · watch ${r.avg_watch_s ?? '—'}s` +
    `${r.nonfollower_view_pct != null ? ` · non-follower ${r.nonfollower_view_pct}%` : ''}  ${(r.title || r.item_id).slice(0, 55)}`
  );
}
const missing = rows.filter((r) => r.follower_view_pct == null).length;
if (missing) console.log(`\n${missing}/${rows.length} videos missing Viewers-tab data — open each video's Viewers tab during capture to fill these.`);
