import { getPitchColor } from '../graphics/registry/pitchColors';

// populateReportCard — given a saved Scene template + a StarterCardData
// payload, return a Scene with each element's `props` filled in. Ported
// from Triton lib/reportCardPopulate.ts; behavior identical.
//
// Each element with `reportCardBinding` is routed to a switch on
// binding.objectType; elements without a binding still get their text
// templated ({title} / {player_name} / etc.) and player-image elements
// get the pitcher's id + name auto-filled when blank.

function formatValue(val, fmt) {
  if (val == null) return '--';
  if (typeof val === 'string') return val;
  switch (fmt) {
    case '1f': return val.toFixed(1);
    case '2f': return val.toFixed(2);
    case '3f': return val.toFixed(3);
    case 'integer': return Math.round(val).toString();
    case 'percent': return `${(val * 100).toFixed(1)}%`;
    default: return String(val);
  }
}

function getStatValue(data, metric) {
  const gl = data.game_line || {};
  const grades = data.grades || {};
  const fb = data.primary_fastball || {};
  const cmd = data.command || {};
  switch (metric) {
    case 'pitches': return gl.pitches;
    case 'ip':      return gl.ip;
    case 'er':      return gl.er;
    case 'h':       return gl.h;
    case 'hr':      return gl.hr;
    case 'bb':      return gl.bb;
    case 'k':       return gl.k;
    case 'whiffs':  return gl.whiffs;
    case 'csw_pct': return gl.csw_pct;
    case 'grade_start':   return grades.start;
    case 'grade_stuff':   return grades.stuff;
    case 'grade_command': return grades.command;
    case 'grade_triton':  return grades.triton;
    case 'fb_velo':  return fb.avg_velo;
    case 'fb_ivb':   return fb.avg_ivb;
    case 'fb_hb':    return fb.avg_hb;
    case 'fb_ext':   return fb.avg_ext;
    case 'fb_havaa': return fb.avg_havaa;
    case 'cmd_plus':     return cmd.cmd_plus;
    case 'waste_pct':    return cmd.waste_pct;
    case 'avg_missfire': return cmd.avg_missfire;
    case 'avg_cluster':  return cmd.avg_cluster;
    case 'avg_brink':    return cmd.avg_brink;
    default: return null;
  }
}

export function populateReportCard(scene, data, title) {
  const populated = (scene.elements || []).map((el) => {
    const binding = el.reportCardBinding;

    if (!binding) {
      if (el.type === 'text' && el.props && el.props.text && title) {
        const newText = el.props.text
          .replace(/\{title\}/gi, title)
          .replace(/\{player_name\}/gi, data.pitcher_name || '')
          .replace(/\{opponent\}/gi, data.opponent || '')
          .replace(/\{game_date\}/gi, data.game_date || '')
          .replace(/\{team\}/gi, data.team || '')
          .replace(/\{p_throws\}/gi, data.p_throws || '');
        return { ...el, props: { ...el.props, text: newText } };
      }
      if (el.type === 'player-image' && !(el.props && el.props.playerId)) {
        return {
          ...el,
          props: {
            ...el.props,
            playerId: data.pitcher_id,
            playerName: data.pitcher_name,
          },
        };
      }
      return el;
    }

    switch (binding.objectType) {
      case 'rc-stat-box': {
        const raw = getStatValue(data, binding.metric || 'k');
        const value = formatValue(raw, binding.format);
        const label = (binding.metric || 'Stat')
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());
        return { ...el, props: { ...el.props, value, label } };
      }

      case 'rc-table': {
        const cols = binding.columns || (el.props && el.props.columns) || [];
        const rows = (data.pitch_metrics || []).map((pm) => {
          const row = {};
          for (const col of cols) {
            const raw = pm[col.key];
            row[col.key] = col.key === 'pitch_name' ? raw : formatValue(raw, col.format);
          }
          row._color = getPitchColor(pm.pitch_name);
          return row;
        });
        return { ...el, props: { ...el.props, rows, columns: cols } };
      }

      case 'rc-heatmap': {
        const allLocs = [
          ...(data.locations_lhb || []),
          ...(data.locations_rhb || []),
        ];
        return { ...el, props: { ...el.props, locations: allLocs } };
      }

      case 'rc-zone-plot': {
        const allLocs = [
          ...(data.locations_lhb || []),
          ...(data.locations_rhb || []),
        ];
        return {
          ...el,
          props: {
            ...el.props,
            pitches: allLocs,
            colorBy: binding.colorBy || 'pitch_type',
          },
        };
      }

      case 'rc-movement-plot': {
        return {
          ...el,
          props: {
            ...el.props,
            pitches: data.movement || [],
            seasonShapes: data.season_movement || [],
          },
        };
      }

      case 'rc-bar-chart': {
        const metric = binding.metric || 'avg_velo';
        const barData = (data.pitch_metrics || [])
          .filter((pm) => pm[metric] != null)
          .map((pm) => ({
            label: pm.pitch_name,
            value: pm[metric],
            color: getPitchColor(pm.pitch_name),
          }));
        return { ...el, props: { ...el.props, barData, metric } };
      }

      case 'rc-donut-chart': {
        const usageData = (data.usage || []).map((u) => ({
          label: u.pitch_name,
          value: u.outing_pct,
          color: getPitchColor(u.pitch_name),
        }));
        return { ...el, props: { ...el.props, usageData } };
      }

      case 'rc-statline': {
        const gl = data.game_line || {};
        return {
          ...el,
          props: {
            ...el.props,
            statline: {
              ip: gl.ip,
              h: gl.h,
              r: gl.r != null ? gl.r : 0,
              k: gl.k,
              bb: gl.bb,
              decision: gl.decision || 'ND',
              era: gl.era || '--',
            },
          },
        };
      }

      default:
        return el;
    }
  });

  return { ...scene, elements: populated };
}
