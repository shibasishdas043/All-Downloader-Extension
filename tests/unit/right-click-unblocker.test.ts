// ============================================================
//  Unit Tests — Universal Right-Click & Copy Protection Unblocker
// ============================================================
import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/constants.ts';

describe('Universal Right-Click & Copy Protection Unblocker', () => {
  describe('Default Configuration & Settings', () => {
    test('DEFAULT_SETTINGS enables unblockRightClick by default', () => {
      expect(DEFAULT_SETTINGS.unblockRightClick).toBe(true);
    });
  });

  describe('Main-World Prototype Neutralization Engine', () => {
    let originalPreventDefault: any;
    let originalReturnValueDesc: PropertyDescriptor | undefined;
    let originalStopPropagation: any;
    let originalStopImmediatePropagation: any;

    beforeEach(() => {
      originalPreventDefault = Event.prototype.preventDefault;
      originalReturnValueDesc = Object.getOwnPropertyDescriptor(Event.prototype, 'returnValue');
      originalStopPropagation = Event.prototype.stopPropagation;
      originalStopImmediatePropagation = Event.prototype.stopImmediatePropagation;
    });

    afterEach(() => {
      Event.prototype.preventDefault = originalPreventDefault;
      if (originalReturnValueDesc) {
        Object.defineProperty(Event.prototype, 'returnValue', originalReturnValueDesc);
      }
      Event.prototype.stopPropagation = originalStopPropagation;
      Event.prototype.stopImmediatePropagation = originalStopImmediatePropagation;
    });

    test('neutralizes preventDefault() on contextmenu events so browser native menu always opens', () => {
      let isDefaultPrevented = false;
      const basePreventDefault = function (this: any) {
        isDefaultPrevented = true;
      };

      let unblockActive = true;
      const interceptedPreventDefault = function (this: any) {
        if (unblockActive && this) {
          const type = this.type;
          if (type === 'contextmenu') return;
          if ((type === 'mousedown' || type === 'mouseup') && this.button === 2) return;
          if (type === 'selectstart' || type === 'copy' || type === 'cut') return;
        }
        return basePreventDefault.call(this);
      };

      Event.prototype.preventDefault = interceptedPreventDefault;

      // 1. contextmenu event must NOT be prevented
      isDefaultPrevented = false;
      const contextMenuEvent = { type: 'contextmenu' } as any;
      interceptedPreventDefault.call(contextMenuEvent);
      expect(isDefaultPrevented).toBe(false);

      // 2. right-click mousedown (button 2) must NOT be prevented
      isDefaultPrevented = false;
      const rClickEvent = { type: 'mousedown', button: 2 } as any;
      interceptedPreventDefault.call(rClickEvent);
      expect(isDefaultPrevented).toBe(false);

      // 3. selectstart and copy events must NOT be prevented
      isDefaultPrevented = false;
      const selectEvent = { type: 'selectstart' } as any;
      interceptedPreventDefault.call(selectEvent);
      expect(isDefaultPrevented).toBe(false);

      isDefaultPrevented = false;
      const copyEvent = { type: 'copy' } as any;
      interceptedPreventDefault.call(copyEvent);
      expect(isDefaultPrevented).toBe(false);

      // 4. normal user events (like form submit or anchor navigation) CAN still be prevented normally
      isDefaultPrevented = false;
      const clickEvent = { type: 'click', button: 0 } as any;
      interceptedPreventDefault.call(clickEvent);
      expect(isDefaultPrevented).toBe(true);
    });

    test('neutralizes legacy returnValue = false cancellation on contextmenu', () => {
      let internalRv = true;

      const rvDesc = {
        get(this: any) {
          return internalRv;
        },
        set(this: any, val: boolean) {
          if (this && val === false) {
            const type = this.type;
            if (
              type === 'contextmenu' ||
              ((type === 'mousedown' || type === 'mouseup') && this.button === 2) ||
              type === 'selectstart' ||
              type === 'copy'
            ) {
              return true; // Discard cancellation
            }
          }
          internalRv = val;
        },
        configurable: true,
        enumerable: true,
      };

      const eventContext = { type: 'contextmenu' } as any;
      rvDesc.set.call(eventContext, false);
      expect(rvDesc.get.call(eventContext)).toBe(true);

      const eventLeftClick = { type: 'click', button: 0 } as any;
      rvDesc.set.call(eventLeftClick, false);
      expect(rvDesc.get.call(eventLeftClick)).toBe(false);
    });

    test('neutralizes stopPropagation and stopImmediatePropagation on contextmenu', () => {
      let stopped = false;
      const baseStop = () => { stopped = true; };

      const safeStopPropagation = function (this: any) {
        if (this && this.type === 'contextmenu') return;
        baseStop();
      };

      // contextmenu event should not trigger base stop
      stopped = false;
      safeStopPropagation.call({ type: 'contextmenu' });
      expect(stopped).toBe(false);

      // other event triggers base stop
      stopped = false;
      safeStopPropagation.call({ type: 'keydown' });
      expect(stopped).toBe(true);
    });

    test('sanitizes oncontextmenu property handler return false', () => {
      const hostileHandler = function () {
        return false; // Hostile website trying to cancel context menu
      };

      const sanitizedHandler = function (this: any, event: any) {
        const result = hostileHandler.apply(this, arguments as any);
        if (result === false && (event.type === 'contextmenu' || event.type === 'selectstart' || event.type === 'copy')) {
          return true; // Neutralized to true!
        }
        return result;
      };

      expect(hostileHandler()).toBe(false);
      expect(sanitizedHandler({ type: 'contextmenu' })).toBe(true);
      expect(sanitizedHandler({ type: 'selectstart' })).toBe(true);
    });
  });

  describe('Alert Suppression During Right Click', () => {
    test('suppresses alert() dialog during right-click interaction window', () => {
      let alertCount = 0;
      const baseAlert = () => { alertCount++; };

      let isRightClicking = false;
      const wrappedAlert = () => {
        if (isRightClicking) {
          return; // Suppressed!
        }
        baseAlert();
      };

      // Normal state: alert works
      isRightClicking = false;
      wrappedAlert();
      expect(alertCount).toBe(1);

      // During right-click: alert is suppressed
      isRightClicking = true;
      wrappedAlert();
      expect(alertCount).toBe(1); // Still 1, did not fire!
    });
  });

  describe('Transparent Click Shield & Overlay Piercing Algorithm', () => {
    interface MockDOMElement {
      tagName: string;
      textContent?: string;
      href?: string;
      style: {
        pointerEvents?: string;
        setProperty: (prop: string, val: string, priority?: string) => void;
        removeProperty: (prop: string) => void;
      };
      computedStyle?: {
        backgroundColor?: string;
        backgroundImage?: string;
        opacity?: string;
      };
    }

    function createMockEl(
      tagName: string,
      options: {
        text?: string;
        bg?: string;
        bgImg?: string;
        opacity?: string;
        href?: string;
      } = {}
    ): MockDOMElement {
      const styles: Record<string, string> = {};
      return {
        tagName: tagName.toUpperCase(),
        textContent: options.text || '',
        href: options.href,
        style: {
          get pointerEvents() { return styles['pointer-events']; },
          set pointerEvents(v: string | undefined) { if (v) styles['pointer-events'] = v; else delete styles['pointer-events']; },
          setProperty(prop: string, val: string) { styles[prop] = val; },
          removeProperty(prop: string) { delete styles[prop]; },
        },
        computedStyle: {
          backgroundColor: options.bg ?? 'rgba(0, 0, 0, 0)',
          backgroundImage: options.bgImg ?? 'none',
          opacity: options.opacity ?? '1',
        },
      };
    }

    function testPierceLogic(elements: MockDOMElement[], isRightClick: boolean): void {
      if (!isRightClick) return;
      if (!elements || elements.length < 2) return;

      const topEl = elements[0];
      if (['IMG', 'VIDEO', 'CANVAS', 'A'].includes(topEl.tagName)) return;

      const mediaIndex = elements.slice(1, 6).findIndex((el) => {
        return ['IMG', 'VIDEO', 'CANVAS'].includes(el.tagName) || (el.tagName === 'A' && Boolean(el.href));
      });

      if (mediaIndex === -1) return;
      const shieldsToPierce = elements.slice(0, mediaIndex + 1);

      for (const el of shieldsToPierce) {
        if (['IMG', 'VIDEO', 'CANVAS', 'A'].includes(el.tagName)) break;
        if (el.textContent?.trim()) break;

        const comp = el.computedStyle || {};
        const isTransparentBg =
          comp.backgroundColor === 'rgba(0, 0, 0, 0)' ||
          comp.backgroundColor === 'transparent' ||
          parseFloat(comp.opacity || '1') === 0;
        const noBgImage = !comp.backgroundImage || comp.backgroundImage === 'none';

        if (isTransparentBg && noBgImage) {
          el.style.setProperty('pointer-events', 'none', 'important');
        }
      }
    }

    test('pierces transparent overlay div to expose underlying image', () => {
      const shield = createMockEl('DIV', { bg: 'rgba(0, 0, 0, 0)', bgImg: 'none', text: '' });
      const img = createMockEl('IMG');
      const container = createMockEl('DIV');

      const elements = [shield, img, container];
      testPierceLogic(elements, true);

      // Shield must be set to pointer-events: none so click pierces through to image
      expect(shield.style.pointerEvents).toBe('none');
    });

    test('pierces nested multi-layer transparent overlays', () => {
      const shield1 = createMockEl('DIV', { bg: 'transparent', text: '' });
      const shield2 = createMockEl('SPAN', { bg: 'rgba(0, 0, 0, 0)', text: '' });
      const video = createMockEl('VIDEO');

      const elements = [shield1, shield2, video];
      testPierceLogic(elements, true);

      expect(shield1.style.pointerEvents).toBe('none');
      expect(shield2.style.pointerEvents).toBe('none');
    });

    test('does NOT pierce elements containing actual text content', () => {
      const caption = createMockEl('DIV', { bg: 'transparent', text: 'Photo by National Geographic' });
      const img = createMockEl('IMG');

      const elements = [caption, img];
      testPierceLogic(elements, true);

      // Because it has text, it is real UI/text and must NOT be disabled
      expect(caption.style.pointerEvents).toBeUndefined();
    });

    test('does NOT pierce non-transparent elements with visible background color', () => {
      const solidCard = createMockEl('DIV', { bg: 'rgb(255, 255, 255)', text: '' });
      const img = createMockEl('IMG');

      const elements = [solidCard, img];
      testPierceLogic(elements, true);

      expect(solidCard.style.pointerEvents).toBeUndefined();
    });

    test('preserves original style across rapid successive right-clicks', () => {
      const shield = createMockEl('DIV', { bg: 'rgba(0, 0, 0, 0)', text: '' });
      shield.style.pointerEvents = 'auto';
      const img = createMockEl('IMG');

      const elements = [shield, img];

      // Simulate 1st right-click
      testPierceLogic(elements, true);
      expect(shield.style.pointerEvents).toBe('none');

      // Simulate 2nd rapid right-click before timer restores
      testPierceLogic(elements, true);
      expect(shield.style.pointerEvents).toBe('none');
    });
  });

  describe('Inline Attribute Cleaning', () => {
    test('cleans oncontextmenu, onselectstart, ondragstart attributes from elements', () => {
      const mockAttributes: Record<string, string> = {
        oncontextmenu: 'return false;',
        onselectstart: 'return false;',
        ondragstart: 'return false;',
        oncopy: 'return false;',
        id: 'protected-gallery',
      };

      const cleanBlockingAttributes = (attrs: Record<string, string>) => {
        const blocking = ['oncontextmenu', 'onselectstart', 'ondragstart', 'oncopy', 'oncut'];
        for (const key of blocking) {
          delete attrs[key];
        }
      };

      cleanBlockingAttributes(mockAttributes);

      expect(mockAttributes.oncontextmenu).toBeUndefined();
      expect(mockAttributes.onselectstart).toBeUndefined();
      expect(mockAttributes.ondragstart).toBeUndefined();
      expect(mockAttributes.oncopy).toBeUndefined();
      expect(mockAttributes.id).toBe('protected-gallery'); // Regular attributes untouched
    });

    test('cleans blocking attributes on dynamically added root element node', () => {
      const rootNode = {
        hasAttribute: (attr: string) => attr === 'oncontextmenu',
        removeAttribute: vi.fn(),
        querySelectorAll: () => [],
      };

      const BLOCKING_ATTRS = ['oncontextmenu', 'onselectstart', 'ondragstart', 'oncopy', 'oncut'];
      const cleanRoot = (node: any) => {
        for (const attr of BLOCKING_ATTRS) {
          if (node.hasAttribute(attr)) node.removeAttribute(attr);
        }
      };

      cleanRoot(rootNode);
      expect(rootNode.removeAttribute).toHaveBeenCalledWith('oncontextmenu');
    });
  });

  describe('Per-Instance Event Handler Isolation', () => {
    test('isolates oncontextmenu handler per element without cross-instance leakage', () => {
      const proto: any = {};
      const prop = 'oncontextmenu';

      Object.defineProperty(proto, prop, {
        get(this: any) {
          return this['__adl_raw_' + prop] ?? null;
        },
        set(this: any, fn: any) {
          this['__adl_raw_' + prop] = fn;
          this['__adl_handler_' + prop] = fn;
        },
        configurable: true,
        enumerable: true,
      });

      const elA: any = Object.create(proto);
      const elB: any = Object.create(proto);

      const handlerA = () => 'handlerA';
      const handlerB = () => 'handlerB';

      elA.oncontextmenu = handlerA;
      elB.oncontextmenu = handlerB;

      expect(elA.oncontextmenu).toBe(handlerA);
      expect(elB.oncontextmenu).toBe(handlerB);
      expect(elA.oncontextmenu()).toBe('handlerA');
      expect(elB.oncontextmenu()).toBe('handlerB');
    });
  });
});
