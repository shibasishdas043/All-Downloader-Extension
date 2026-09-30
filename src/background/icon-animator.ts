// ============================================================
//  All-Downloader — Toolbar Icon Animator
//  Dynamic canvas animation on the Chrome toolbar action icon
//  to visually indicate download initiation without opening popups
// ============================================================

let animationInterval: ReturnType<typeof setInterval> | null = null;
let currentFrame = 0;
const TOTAL_FRAMES = 28; // ~2.24 seconds at 80ms/frame (2 complete cycles)
const FRAME_DELAY_MS = 80;

// Reusable offscreen canvases to avoid memory allocation churn
let canvas32: OffscreenCanvas | null = null;
let ctx32: OffscreenCanvasRenderingContext2D | null = null;
let canvas16: OffscreenCanvas | null = null;
let ctx16: OffscreenCanvasRenderingContext2D | null = null;

function initCanvases(): boolean {
  if (typeof OffscreenCanvas === 'undefined') return false;
  if (!canvas32) {
    try {
      canvas32 = new OffscreenCanvas(32, 32);
      ctx32 = canvas32.getContext('2d') as OffscreenCanvasRenderingContext2D;
      canvas16 = new OffscreenCanvas(16, 16);
      ctx16 = canvas16.getContext('2d') as OffscreenCanvasRenderingContext2D;
    } catch {
      return false;
    }
  }
  return !!(ctx32 && ctx16);
}

/**
 * Draw a single frame of the download start arrow-drop animation.
 * @param ctx 2D rendering context
 * @param progress 0.0 to 1.0 per cycle
 */
function drawFrame32(ctx: OffscreenCanvasRenderingContext2D, progress: number): void {
  ctx.clearRect(0, 0, 32, 32);

  // 1. Dark circular container badge for high contrast on light & dark browser toolbars
  ctx.fillStyle = '#0f172a'; // Deep slate
  ctx.beginPath();
  ctx.arc(16, 16, 15, 0, Math.PI * 2);
  ctx.fill();

  // Electric cyan border ring
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 2. Tray at the bottom
  ctx.strokeStyle = '#38bdf8'; // Sky cyan
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(8, 23);
  ctx.lineTo(24, 23);
  ctx.stroke();

  // 3. Arrow dropping animation
  // y moves from 5 to 15
  const dropCycle = Math.min(progress / 0.72, 1.0);
  const arrowY = 5 + dropCycle * 9;
  const arrowAlpha = progress > 0.82 ? Math.max(0, 1 - (progress - 0.82) / 0.18) : 1;

  ctx.save();
  ctx.globalAlpha = arrowAlpha;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Arrow stem
  ctx.beginPath();
  ctx.moveTo(16, arrowY - 4);
  ctx.lineTo(16, arrowY + 3);
  ctx.stroke();

  // Arrow head V-shape
  ctx.beginPath();
  ctx.moveTo(11.5, arrowY);
  ctx.lineTo(16, arrowY + 4.5);
  ctx.lineTo(20.5, arrowY);
  ctx.stroke();
  ctx.restore();

  // 4. Expanding ripple shockwave when arrow reaches tray
  if (progress > 0.6) {
    const rippleProgress = (progress - 0.6) / 0.4;
    const rippleRadius = 2 + rippleProgress * 10;
    const rippleAlpha = Math.max(0, 1 - rippleProgress);

    ctx.save();
    ctx.strokeStyle = `rgba(56, 189, 248, ${rippleAlpha * 0.9})`;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(16, 23, rippleRadius, Math.PI, Math.PI * 2); // upward arc
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Trigger the dynamic download start toolbar icon animation.
 * Replaces popup drop-down flash with satisfying toolbar icon animation.
 */
export function playDownloadStartAnimation(onComplete?: () => void): void {
  stopDownloadStartAnimation();

  const hasCanvas = initCanvases();
  currentFrame = 0;

  // Badge pulse colors
  const badgePulseColors = ['#00f0ff', '#38bdf8', '#10b981', '#0284c7'];

  animationInterval = setInterval(() => {
    currentFrame++;

    // End of animation sequence — stop before drawing any more frames
    if (currentFrame >= TOTAL_FRAMES) {
      stopDownloadStartAnimation();
      if (onComplete) onComplete();
      return;
    }

    // Calculate progress through a 14-frame cycle (2 cycles total)
    const cycleFrames = 14;
    const cycleProgress = (currentFrame % cycleFrames) / cycleFrames;

    // 1. Draw canvas frame if OffscreenCanvas is available
    if (hasCanvas && ctx32 && ctx16 && canvas32) {
      try {
        drawFrame32(ctx32, cycleProgress);

        ctx16.clearRect(0, 0, 16, 16);
        ctx16.drawImage(canvas32 as any, 0, 0, 16, 16);

        const imgData32 = ctx32.getImageData(0, 0, 32, 32);
        const imgData16 = ctx16.getImageData(0, 0, 16, 16);

        chrome.action.setIcon({
          imageData: {
            16: imgData16 as any,
            32: imgData32 as any,
          },
        });
      } catch (err) {
        console.warn('[ADL Animator] setIcon error:', err);
      }
    }

    // 2. Animate badge text and pulsing background color
    const badgeColor = badgePulseColors[currentFrame % badgePulseColors.length] || '#00f0ff';
    chrome.action.setBadgeBackgroundColor({ color: badgeColor });
    chrome.action.setBadgeText({ text: currentFrame % 4 < 2 ? '↓' : '⤓' });
  }, FRAME_DELAY_MS);
}

/**
 * Stop and clean up any active animation, restoring default static icon.
 */
export function stopDownloadStartAnimation(): void {
  if (animationInterval) {
    clearInterval(animationInterval);
    animationInterval = null;
  }
  currentFrame = 0;

  try {
    // In Chrome MV3, passing path: {} resets any programmatic icon (both imageData and custom path)
    // back to the default icon specified in manifest.json.
    chrome.action.setIcon({ path: {} }, () => {
      if (chrome.runtime?.lastError) {
        // Fallback to explicit relative paths if needed
        chrome.action.setIcon({
          path: {
            16:  'src/assets/icons/icon16.png',
            32:  'src/assets/icons/icon32.png',
            48:  'src/assets/icons/icon48.png',
            128: 'src/assets/icons/icon128.png',
          },
        });
      }
    });
  } catch {
    // Ignore in tests or unloaded contexts
  }
}
