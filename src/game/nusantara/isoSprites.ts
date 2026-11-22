import {
  TILE_H,
  TILE_W,
  type Direction,
  type HairStyle,
  type ObjectType,
  type PlayerRole,
} from './schoolMap';

export interface SpriteBubble {
  text: string;
  expires: number;
}

export interface SpriteEmote {
  emoji: string;
  expires: number;
}

export function toIso(wx: number, wy: number): { x: number; y: number } {
  return {
    x: (wx - wy) * (TILE_W / 2),
    y: (wx + wy) * (TILE_H / 2),
  };
}

function drawIsoBox(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  wRatio: number,
  hPx: number,
  colTop: string,
  colLeft: string,
  colRight: string
) {
  const hw = (TILE_W / 2) * wRatio;
  const hh = (TILE_H / 2) * wRatio;
  const topY = cy + (TILE_H / 2) * (1 - wRatio);

  // Top face
  ctx.beginPath();
  ctx.moveTo(cx, topY - hPx);
  ctx.lineTo(cx + hw, topY + hh - hPx);
  ctx.lineTo(cx, topY + hh * 2 - hPx);
  ctx.lineTo(cx - hw, topY + hh - hPx);
  ctx.closePath();
  ctx.fillStyle = colTop;
  ctx.fill();

  // Left face
  ctx.beginPath();
  ctx.moveTo(cx - hw, topY + hh - hPx);
  ctx.lineTo(cx, topY + hh * 2 - hPx);
  ctx.lineTo(cx, topY + hh * 2);
  ctx.lineTo(cx - hw, topY + hh);
  ctx.closePath();
  ctx.fillStyle = colLeft;
  ctx.fill();

  // Right face
  ctx.beginPath();
  ctx.moveTo(cx + hw, topY + hh - hPx);
  ctx.lineTo(cx, topY + hh * 2 - hPx);
  ctx.lineTo(cx, topY + hh * 2);
  ctx.lineTo(cx + hw, topY + hh);
  ctx.closePath();
  ctx.fillStyle = colRight;
  ctx.fill();
}

export function drawWorldObject(
  ctx: CanvasRenderingContext2D,
  type: ObjectType,
  tx: number,
  ty: number,
  camX: number,
  camY: number,
  now: number
) {
  const pos = toIso(tx, ty);
  const sx = pos.x - camX;
  const sy = pos.y - camY;

  switch (type) {
    case 'wall':
      drawIsoBox(ctx, sx, sy, 1, 46, '#f8fafc', '#cbd5e1', '#94a3b8');
      break;
    case 'window_wall':
      drawIsoBox(ctx, sx, sy, 1, 46, '#f8fafc', '#cbd5e1', '#94a3b8');
      ctx.fillStyle = '#7dd3fc';
      ctx.fillRect(sx - 12, sy - 22, 10, 14);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(sx + 2, sy - 22, 10, 14);
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(sx - 12, sy - 22, 10, 14);
      ctx.strokeRect(sx + 2, sy - 22, 10, 14);
      break;
    case 'brick_wall':
      drawIsoBox(ctx, sx, sy, 1, 34, '#fca5a5', '#dc2626', '#991b1b');
      break;
    case 'gate':
      drawIsoBox(ctx, sx, sy, 0.92, 62, '#f1f5f9', '#64748b', '#475569');
      drawIsoBox(ctx, sx, sy - 62, 1.02, 6, '#fbbf24', '#d97706', '#b45309');
      if (tx === 13) {
        ctx.font = 'bold 10px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(sx - 2, sy - 58, 128, 16);
        ctx.fillStyle = '#fef08a';
        ctx.fillText('SMA NUSANTARA', sx + 62, sy - 46);
      }
      break;
    case 'board':
      drawIsoBox(ctx, sx, sy, 1, 46, '#f8fafc', '#cbd5e1', '#94a3b8');
      ctx.fillStyle = '#065f46';
      ctx.fillRect(sx - 16, sy - 22, 32, 20);
      ctx.strokeStyle = '#92400e';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx - 16, sy - 22, 32, 20);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(sx - 11, sy - 16, 18, 2);
      ctx.fillRect(sx - 11, sy - 11, 12, 2);
      break;
    case 'desk':
      drawIsoBox(ctx, sx, sy, 0.74, 16, '#d97706', '#b45309', '#78350f');
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(sx - 6, sy - 4, 11, 7);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(sx - 5, sy - 3, 4, 5);
      break;
    case 'chair':
      drawIsoBox(ctx, sx, sy, 0.44, 9, '#38bdf8', '#0284c7', '#0369a1');
      break;
    case 'bench':
      drawIsoBox(ctx, sx, sy, 0.84, 10, '#a16207', '#854d0e', '#713f12');
      break;
    case 'podium':
      drawIsoBox(ctx, sx, sy, 0.7, 18, '#b45309', '#92400e', '#78350f');
      break;
    case 'locker':
      drawIsoBox(ctx, sx, sy, 0.75, 40, '#60a5fa', '#2563eb', '#1d4ed8');
      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(sx - 8, sy - 18, 6, 3);
      ctx.fillRect(sx + 2, sy - 18, 6, 3);
      break;
    case 'bookshelf':
      drawIsoBox(ctx, sx, sy, 0.85, 40, '#92400e', '#78350f', '#451a03');
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(sx - 11, sy - 18, 5, 9);
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(sx - 5, sy - 18, 5, 9);
      ctx.fillStyle = '#eab308';
      ctx.fillRect(sx + 1, sy - 18, 5, 9);
      ctx.fillStyle = '#10b981';
      ctx.fillRect(sx + 7, sy - 18, 4, 9);
      break;
    case 'stall':
      drawIsoBox(ctx, sx, sy, 0.9, 28, '#fef08a', '#f97316', '#c2410c');
      drawIsoBox(ctx, sx, sy - 27, 0.96, 8, '#ef4444', '#dc2626', '#991b1b');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx - 14, sy - 21, 6, 5);
      ctx.fillRect(sx + 4, sy - 21, 6, 5);
      break;
    case 'tree':
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.ellipse(sx, sy + 16, 18, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      drawIsoBox(ctx, sx, sy, 0.3, 24, '#78350f', '#451a03', '#290d02');
      drawIsoBox(ctx, sx, sy - 22, 0.88, 22, '#4ade80', '#16a34a', '#15803d');
      drawIsoBox(ctx, sx, sy - 40, 0.56, 16, '#86efac', '#22c55e', '#16a34a');
      break;
    case 'flower': {
      drawIsoBox(ctx, sx, sy, 0.6, 7, '#22c55e', '#15803d', '#166534');
      const bloomCols = ['#f43f5e', '#fbbf24', '#ec4899'];
      ctx.fillStyle = bloomCols[(tx + ty) % bloomCols.length];
      ctx.beginPath();
      ctx.arc(sx - 5, sy + 4, 3, 0, Math.PI * 2);
      ctx.arc(sx + 5, sy + 6, 3, 0, Math.PI * 2);
      ctx.arc(sx, sy + 1, 2.8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'hoop':
      drawIsoBox(ctx, sx, sy, 0.24, 60, '#e2e8f0', '#64748b', '#475569');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx - 15, sy - 60, 30, 19);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx - 7, sy - 52, 14, 9);
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(sx, sy - 41, 7, 3, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'flagpole': {
      drawIsoBox(ctx, sx, sy, 0.52, 7, '#e2e8f0', '#94a3b8', '#64748b');
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, sy + 10);
      ctx.lineTo(sx, sy - 88);
      ctx.stroke();
      const wave = Math.sin(now / 220) * 2.5;
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(sx + 1, sy - 87 + wave * 0.3, 28, 9.5);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx + 1, sy - 77.5 + wave * 0.3, 28, 9.5);
      break;
    }
  }
}

export function drawCharacterSprite(
  ctx: CanvasRenderingContext2D,
  p: {
    id: string;
    name: string;
    role: PlayerRole;
    hairStyle?: HairStyle;
    hairColor: string;
    skinColor: string;
    dir: Direction;
    moving: boolean;
    sitting: boolean;
    jumpOffset: number;
    walkPhase: number;
  },
  sx: number,
  syBase: number,
  isSelf: boolean,
  bubble?: SpriteBubble,
  emote?: SpriteEmote,
  now = performance.now(),
  showTag = true
) {
  const sy = syBase - (p.jumpOffset || 0) - (p.sitting ? -4 : 0);
  const style: HairStyle = p.hairStyle || 'short';
  const hairCol = p.hairColor || (style === 'hijab' ? '#f8fafc' : '#1e293b');
  const skinCol = p.skinColor || '#f6d198';

  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.beginPath();
  ctx.ellipse(sx, syBase + 2, 11, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();

  let shirt = '#ffffff';
  let pants = '#64748b';
  if (p.role === 'smp') {
    shirt = '#ffffff';
    pants = '#1d4ed8';
  } else if (p.role === 'osis') {
    shirt = '#1e3a8a';
    pants = '#334155';
  } else if (p.role === 'guru') {
    shirt = '#b45309';
    pants = '#1e293b';
  }

  const legSwing = p.moving ? Math.sin(p.walkPhase) * 4.5 : 0;
  const armSwing = p.moving ? Math.cos(p.walkPhase) * 3.5 : 0;
  const hairBounce = p.moving ? Math.sin(p.walkPhase * 2) * 0.9 : 0;

  if (style === 'long' && p.dir !== 'n') {
    ctx.fillStyle = hairCol;
    if (p.dir === 's') {
      ctx.beginPath();
      ctx.roundRect(sx - 10.5, sy - 41, 21, 21 + hairBounce, 6);
      ctx.fill();
    } else if (p.dir === 'e') {
      ctx.beginPath();
      ctx.roundRect(sx - 12, sy - 41, 13, 21 + hairBounce, 5);
      ctx.fill();
    } else if (p.dir === 'w') {
      ctx.beginPath();
      ctx.roundRect(sx - 1, sy - 41, 13, 21 + hairBounce, 5);
      ctx.fill();
    }
  }

  if (!p.sitting) {
    if (style === 'hijab') {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(sx - 6, sy - 2 + legSwing * 0.7, 5, 3);
      ctx.fillRect(sx + 1, sy - 2 - legSwing * 0.7, 5, 3);
      const sway = legSwing * 0.35;
      ctx.fillStyle = pants;
      ctx.beginPath();
      ctx.moveTo(sx - 8, sy - 15);
      ctx.lineTo(sx + 8, sy - 15);
      ctx.lineTo(sx + 10 + sway, sy - 3);
      ctx.lineTo(sx - 10 + sway, sy - 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(sx - 2 + sway * 0.5, sy - 14, 1.5, 10);
      ctx.fillRect(sx + 2.5 + sway * 0.5, sy - 14, 1.5, 10);
    } else {
      ctx.fillStyle = pants;
      ctx.fillRect(sx - 6, sy - 14 + legSwing, 5, 14);
      ctx.fillRect(sx + 1, sy - 14 - legSwing, 5, 14);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(sx - 6, sy - 2 + legSwing, 5, 3);
      ctx.fillRect(sx + 1, sy - 2 - legSwing, 5, 3);

      if (style === 'long') {
        const sway = legSwing * 0.25;
        ctx.fillStyle = pants;
        ctx.beginPath();
        ctx.moveTo(sx - 8, sy - 15);
        ctx.lineTo(sx + 8, sy - 15);
        ctx.lineTo(sx + 9.5 + sway, sy - 7);
        ctx.lineTo(sx - 9.5 + sway, sy - 7);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(sx - 3, sy - 14, 1.4, 6.5);
        ctx.fillRect(sx + 2, sy - 14, 1.4, 6.5);
      }
    }
  } else {
    ctx.fillStyle = pants;
    ctx.fillRect(sx - 8, sy - 11, 16, 8);
  }

  ctx.fillStyle = shirt;
  ctx.fillRect(sx - 11, sy - 29 - armSwing, 3.5, 13);
  ctx.fillRect(sx + 7.5, sy - 29 + armSwing, 3.5, 13);

  ctx.fillStyle = shirt;
  ctx.fillRect(sx - 8, sy - 31, 16, 18);

  if (p.role === 'sma' || p.role === 'smp') {
    if (p.dir !== 'n') {
      ctx.fillStyle = p.role === 'sma' ? '#64748b' : '#1d4ed8';
      ctx.fillRect(sx - 1.5, sy - 29, 3, 10);
    }
  } else if (p.role === 'osis') {
    if (p.dir !== 'n') {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(sx - 2, sy - 30, 4, 8);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(sx + 3, sy - 26, 2.5, 2.5);
    }
  } else if (p.role === 'guru') {
    ctx.fillStyle = '#fde68a';
    ctx.fillRect(sx - 5, sy - 27, 2, 2);
    ctx.fillRect(sx + 2, sy - 23, 2, 2);
    ctx.fillRect(sx - 3, sy - 19, 2, 2);
  }

  if (style === 'hijab') {
    if (p.dir === 'n') {
      ctx.fillStyle = hairCol;
      ctx.beginPath();
      ctx.roundRect(sx - 10.5, sy - 37, 21, 17, 6);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sx, sy - 39.5, 10.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.22)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx - 8, sy - 24);
      ctx.quadraticCurveTo(sx, sy - 21, sx + 8, sy - 24);
      ctx.stroke();
    } else {
      ctx.fillStyle = hairCol;
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy - 32);
      ctx.lineTo(sx + 10, sy - 32);
      ctx.lineTo(sx + 11.5, sy - 22);
      ctx.quadraticCurveTo(sx, sy - 16, sx - 11.5, sy - 22);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.22)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.fillStyle = hairCol;
      ctx.beginPath();
      ctx.arc(sx, sy - 39.5, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.22)';
      ctx.lineWidth = 1.1;
      ctx.stroke();

      const faceOffX = p.dir === 'e' ? 2.4 : p.dir === 'w' ? -2.4 : 0;
      ctx.fillStyle = skinCol;
      ctx.beginPath();
      ctx.arc(sx + faceOffX, sy - 38.8, 7.3, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(15, 23, 42, 0.16)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(sx + faceOffX, sy - 38.8, 7.3, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();

      ctx.fillStyle = '#0f172a';
      const eyeOffX = p.dir === 'e' ? 3 : p.dir === 'w' ? -3 : 0;
      ctx.fillRect(sx - 3.3 + eyeOffX, sy - 39, 2.1, 2.4);
      ctx.fillRect(sx + 1.3 + eyeOffX, sy - 39, 2.1, 2.4);
    }
  } else {
    ctx.fillStyle = skinCol;
    ctx.beginPath();
    ctx.arc(sx, sy - 39, 9.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = hairCol;
    if (p.dir === 'n') {
      if (style === 'long') {
        ctx.beginPath();
        ctx.roundRect(sx - 10, sy - 39, 20, 20 + hairBounce, 5);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.fillRect(sx - 8, sy - 23 + hairBounce, 16, 2);
        ctx.fillStyle = hairCol;
      }
      ctx.beginPath();
      ctx.arc(sx, sy - 40, 10, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(sx, sy - 42, 10, Math.PI, Math.PI * 2);
      ctx.fill();
      if (style === 'long') {
        ctx.fillRect(sx - 9.8, sy - 42, 3.3, 18 + hairBounce * 0.5);
        ctx.fillRect(sx + 6.5, sy - 42, 3.3, 18 + hairBounce * 0.5);
        ctx.beginPath();
        ctx.moveTo(sx - 8, sy - 42);
        ctx.quadraticCurveTo(sx - 3, sy - 40, sx - 0.5, sy - 44);
        ctx.quadraticCurveTo(sx + 3, sy - 40, sx + 8, sy - 42);
        ctx.lineTo(sx + 8, sy - 46);
        ctx.lineTo(sx - 8, sy - 46);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(sx - 9.5, sy - 42, 3, 5);
        ctx.fillRect(sx + 6.5, sy - 42, 3, 5);
      }
    }

    if (p.dir !== 'n') {
      ctx.fillStyle = '#0f172a';
      const eyeOffX = p.dir === 'e' ? 3 : p.dir === 'w' ? -3 : 0;
      ctx.fillRect(sx - 3.5 + eyeOffX, sy - 39, 2.2, 2.5);
      ctx.fillRect(sx + 1.5 + eyeOffX, sy - 39, 2.2, 2.5);
    }
  }

  if (!showTag) return;

  ctx.font = '600 11px "DM Sans", sans-serif';
  ctx.textAlign = 'center';
  const tagText = p.role === 'guru' ? `Guru · ${p.name}` : p.name;
  const tagW = ctx.measureText(tagText).width + 12;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
  ctx.beginPath();
  ctx.roundRect(sx - tagW / 2, sy - 67, tagW, 17, 4);
  ctx.fill();
  ctx.fillStyle = isSelf ? '#38bdf8' : '#f8fafc';
  ctx.fillText(tagText, sx, sy - 54.5);

  if (emote && emote.expires > now) {
    ctx.font = '20px sans-serif';
    ctx.fillText(emote.emoji, sx, sy - 76);
  }

  if (bubble && bubble.expires > now) {
    ctx.font = '500 12px "DM Sans", sans-serif';
    const clipped = bubble.text.length > 30 ? `${bubble.text.slice(0, 29)}…` : bubble.text;
    const bw = Math.min(200, ctx.measureText(clipped).width + 18);
    const by = sy - 88;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(sx - bw / 2, by - 16, bw, 23, 6);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.fillText(clipped, sx, by - 0.5);
  }
}
