var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i7 = decorators.length - 1, decorator; i7 >= 0; i7--)
    if (decorator = decorators[i7])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};

// @lit-labs/ssr-dom-shim/lib/element-internals.js
var ElementInternalsShim = class ElementInternals {
  get shadowRoot() {
    return this.__host.__shadowRoot;
  }
  constructor(_host) {
    this.ariaActiveDescendantElement = null;
    this.ariaAtomic = "";
    this.ariaAutoComplete = "";
    this.ariaBrailleLabel = "";
    this.ariaBrailleRoleDescription = "";
    this.ariaBusy = "";
    this.ariaChecked = "";
    this.ariaColCount = "";
    this.ariaColIndex = "";
    this.ariaColIndexText = "";
    this.ariaColSpan = "";
    this.ariaControlsElements = null;
    this.ariaCurrent = "";
    this.ariaDescribedByElements = null;
    this.ariaDescription = "";
    this.ariaDetailsElements = null;
    this.ariaDisabled = "";
    this.ariaErrorMessageElements = null;
    this.ariaExpanded = "";
    this.ariaFlowToElements = null;
    this.ariaHasPopup = "";
    this.ariaHidden = "";
    this.ariaInvalid = "";
    this.ariaKeyShortcuts = "";
    this.ariaLabel = "";
    this.ariaLabelledByElements = null;
    this.ariaLevel = "";
    this.ariaLive = "";
    this.ariaModal = "";
    this.ariaMultiLine = "";
    this.ariaMultiSelectable = "";
    this.ariaOrientation = "";
    this.ariaOwnsElements = null;
    this.ariaPlaceholder = "";
    this.ariaPosInSet = "";
    this.ariaPressed = "";
    this.ariaReadOnly = "";
    this.ariaRelevant = "";
    this.ariaRequired = "";
    this.ariaRoleDescription = "";
    this.ariaRowCount = "";
    this.ariaRowIndex = "";
    this.ariaRowIndexText = "";
    this.ariaRowSpan = "";
    this.ariaSelected = "";
    this.ariaSetSize = "";
    this.ariaSort = "";
    this.ariaValueMax = "";
    this.ariaValueMin = "";
    this.ariaValueNow = "";
    this.ariaValueText = "";
    this.role = "";
    this.form = null;
    this.labels = [];
    this.states = /* @__PURE__ */ new Set();
    this.validationMessage = "";
    this.validity = {};
    this.willValidate = true;
    this.__host = _host;
  }
  checkValidity() {
    console.warn("`ElementInternals.checkValidity()` was called on the server.This method always returns true.");
    return true;
  }
  reportValidity() {
    return true;
  }
  setFormValue() {
  }
  setValidity() {
  }
};

// @lit-labs/ssr-dom-shim/lib/events.js
var __classPrivateFieldSet = function(receiver, state, value, kind, f3) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f3) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f3 : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f3.call(receiver, value) : f3 ? f3.value = value : state.set(receiver, value), value;
};
var __classPrivateFieldGet = function(receiver, state, kind, f3) {
  if (kind === "a" && !f3) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f3 : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f3 : kind === "a" ? f3.call(receiver) : f3 ? f3.value : state.get(receiver);
};
var _Event_cancelable;
var _Event_bubbles;
var _Event_composed;
var _Event_defaultPrevented;
var _Event_timestamp;
var _Event_propagationStopped;
var _Event_type;
var _Event_target;
var _Event_isBeingDispatched;
var _a;
var _CustomEvent_detail;
var _b;
var NONE = 0;
var CAPTURING_PHASE = 1;
var AT_TARGET = 2;
var BUBBLING_PHASE = 3;
var enumerableProperty = { __proto__: null };
enumerableProperty.enumerable = true;
Object.freeze(enumerableProperty);
var EventShim = (_a = class Event {
  constructor(type, options = {}) {
    _Event_cancelable.set(this, false);
    _Event_bubbles.set(this, false);
    _Event_composed.set(this, false);
    _Event_defaultPrevented.set(this, false);
    _Event_timestamp.set(this, Date.now());
    _Event_propagationStopped.set(this, false);
    _Event_type.set(this, void 0);
    _Event_target.set(this, void 0);
    _Event_isBeingDispatched.set(this, void 0);
    this.NONE = NONE;
    this.CAPTURING_PHASE = CAPTURING_PHASE;
    this.AT_TARGET = AT_TARGET;
    this.BUBBLING_PHASE = BUBBLING_PHASE;
    if (arguments.length === 0)
      throw new Error(`The type argument must be specified`);
    if (typeof options !== "object" || !options) {
      throw new Error(`The "options" argument must be an object`);
    }
    const { bubbles, cancelable, composed } = options;
    __classPrivateFieldSet(this, _Event_cancelable, !!cancelable, "f");
    __classPrivateFieldSet(this, _Event_bubbles, !!bubbles, "f");
    __classPrivateFieldSet(this, _Event_composed, !!composed, "f");
    __classPrivateFieldSet(this, _Event_type, `${type}`, "f");
    __classPrivateFieldSet(this, _Event_target, null, "f");
    __classPrivateFieldSet(this, _Event_isBeingDispatched, false, "f");
  }
  initEvent(_type, _bubbles, _cancelable) {
    throw new Error("Method not implemented.");
  }
  stopImmediatePropagation() {
    this.stopPropagation();
  }
  preventDefault() {
    __classPrivateFieldSet(this, _Event_defaultPrevented, true, "f");
  }
  get target() {
    return __classPrivateFieldGet(this, _Event_target, "f");
  }
  get currentTarget() {
    return __classPrivateFieldGet(this, _Event_target, "f");
  }
  get srcElement() {
    return __classPrivateFieldGet(this, _Event_target, "f");
  }
  get type() {
    return __classPrivateFieldGet(this, _Event_type, "f");
  }
  get cancelable() {
    return __classPrivateFieldGet(this, _Event_cancelable, "f");
  }
  get defaultPrevented() {
    return __classPrivateFieldGet(this, _Event_cancelable, "f") && __classPrivateFieldGet(this, _Event_defaultPrevented, "f");
  }
  get timeStamp() {
    return __classPrivateFieldGet(this, _Event_timestamp, "f");
  }
  composedPath() {
    return __classPrivateFieldGet(this, _Event_isBeingDispatched, "f") ? [__classPrivateFieldGet(this, _Event_target, "f")] : [];
  }
  get returnValue() {
    return !__classPrivateFieldGet(this, _Event_cancelable, "f") || !__classPrivateFieldGet(this, _Event_defaultPrevented, "f");
  }
  get bubbles() {
    return __classPrivateFieldGet(this, _Event_bubbles, "f");
  }
  get composed() {
    return __classPrivateFieldGet(this, _Event_composed, "f");
  }
  get eventPhase() {
    return __classPrivateFieldGet(this, _Event_isBeingDispatched, "f") ? _a.AT_TARGET : _a.NONE;
  }
  get cancelBubble() {
    return __classPrivateFieldGet(this, _Event_propagationStopped, "f");
  }
  set cancelBubble(value) {
    if (value) {
      __classPrivateFieldSet(this, _Event_propagationStopped, true, "f");
    }
  }
  stopPropagation() {
    __classPrivateFieldSet(this, _Event_propagationStopped, true, "f");
  }
  get isTrusted() {
    return false;
  }
}, _Event_cancelable = /* @__PURE__ */ new WeakMap(), _Event_bubbles = /* @__PURE__ */ new WeakMap(), _Event_composed = /* @__PURE__ */ new WeakMap(), _Event_defaultPrevented = /* @__PURE__ */ new WeakMap(), _Event_timestamp = /* @__PURE__ */ new WeakMap(), _Event_propagationStopped = /* @__PURE__ */ new WeakMap(), _Event_type = /* @__PURE__ */ new WeakMap(), _Event_target = /* @__PURE__ */ new WeakMap(), _Event_isBeingDispatched = /* @__PURE__ */ new WeakMap(), _a.NONE = NONE, _a.CAPTURING_PHASE = CAPTURING_PHASE, _a.AT_TARGET = AT_TARGET, _a.BUBBLING_PHASE = BUBBLING_PHASE, _a);
Object.defineProperties(EventShim.prototype, {
  initEvent: enumerableProperty,
  stopImmediatePropagation: enumerableProperty,
  preventDefault: enumerableProperty,
  target: enumerableProperty,
  currentTarget: enumerableProperty,
  srcElement: enumerableProperty,
  type: enumerableProperty,
  cancelable: enumerableProperty,
  defaultPrevented: enumerableProperty,
  timeStamp: enumerableProperty,
  composedPath: enumerableProperty,
  returnValue: enumerableProperty,
  bubbles: enumerableProperty,
  composed: enumerableProperty,
  eventPhase: enumerableProperty,
  cancelBubble: enumerableProperty,
  stopPropagation: enumerableProperty,
  isTrusted: enumerableProperty
});
var CustomEventShim = (_b = class CustomEvent2 extends EventShim {
  constructor(type, options = {}) {
    super(type, options);
    _CustomEvent_detail.set(this, void 0);
    __classPrivateFieldSet(this, _CustomEvent_detail, options?.detail ?? null, "f");
  }
  initCustomEvent(_type, _bubbles, _cancelable, _detail) {
    throw new Error("Method not implemented.");
  }
  get detail() {
    return __classPrivateFieldGet(this, _CustomEvent_detail, "f");
  }
}, _CustomEvent_detail = /* @__PURE__ */ new WeakMap(), _b);
Object.defineProperties(CustomEventShim.prototype, {
  detail: enumerableProperty
});
var EventShimWithRealType = EventShim;
var CustomEventShimWithRealType = CustomEventShim;

// @lit-labs/ssr-dom-shim/lib/css.js
var _a2;
var CSSRuleShim = (_a2 = class CSSRule {
  constructor() {
    this.STYLE_RULE = 1;
    this.CHARSET_RULE = 2;
    this.IMPORT_RULE = 3;
    this.MEDIA_RULE = 4;
    this.FONT_FACE_RULE = 5;
    this.PAGE_RULE = 6;
    this.NAMESPACE_RULE = 10;
    this.KEYFRAMES_RULE = 7;
    this.KEYFRAME_RULE = 8;
    this.SUPPORTS_RULE = 12;
    this.COUNTER_STYLE_RULE = 11;
    this.FONT_FEATURE_VALUES_RULE = 14;
    this.MARGIN_RULE = 9;
    this.__parentStyleSheet = null;
    this.cssText = "";
  }
  get parentRule() {
    return null;
  }
  get parentStyleSheet() {
    return this.__parentStyleSheet;
  }
  get type() {
    return 0;
  }
}, _a2.STYLE_RULE = 1, _a2.CHARSET_RULE = 2, _a2.IMPORT_RULE = 3, _a2.MEDIA_RULE = 4, _a2.FONT_FACE_RULE = 5, _a2.PAGE_RULE = 6, _a2.NAMESPACE_RULE = 10, _a2.KEYFRAMES_RULE = 7, _a2.KEYFRAME_RULE = 8, _a2.SUPPORTS_RULE = 12, _a2.COUNTER_STYLE_RULE = 11, _a2.FONT_FEATURE_VALUES_RULE = 14, _a2.MARGIN_RULE = 9, _a2);

// @lit-labs/ssr-dom-shim/index.js
globalThis.Event ??= EventShimWithRealType;
globalThis.CustomEvent ??= CustomEventShimWithRealType;
var constructionToken = Symbol();
var isCaptureEventListener = (options) => typeof options === "boolean" ? options : options?.capture ?? false;
var enumerableProperty2 = { __proto__: null };
enumerableProperty2.enumerable = true;
Object.freeze(enumerableProperty2);
var EventTarget = class {
  constructor() {
    this.__eventListeners = /* @__PURE__ */ new Map();
    this.__captureEventListeners = /* @__PURE__ */ new Map();
  }
  addEventListener(type, callback, options) {
    if (callback === void 0 || callback === null) {
      return;
    }
    const eventListenersMap = isCaptureEventListener(options) ? this.__captureEventListeners : this.__eventListeners;
    let eventListeners = eventListenersMap.get(type);
    if (eventListeners === void 0) {
      eventListeners = /* @__PURE__ */ new Map();
      eventListenersMap.set(type, eventListeners);
    } else if (eventListeners.has(callback)) {
      return;
    }
    const normalizedOptions = typeof options === "object" && options ? options : {};
    normalizedOptions.signal?.addEventListener("abort", () => this.removeEventListener(type, callback, options));
    eventListeners.set(callback, normalizedOptions ?? {});
  }
  removeEventListener(type, callback, options) {
    if (callback === void 0 || callback === null) {
      return;
    }
    const eventListenersMap = isCaptureEventListener(options) ? this.__captureEventListeners : this.__eventListeners;
    const eventListeners = eventListenersMap.get(type);
    if (eventListeners !== void 0) {
      eventListeners.delete(callback);
      if (!eventListeners.size) {
        eventListenersMap.delete(type);
      }
    }
  }
  dispatchEvent(event) {
    let composedPath = this.__resolveFullEventPath();
    if (!event.composed && this.__host) {
      composedPath = composedPath.slice(0, composedPath.indexOf(this.__host));
    }
    let stopPropagation = false;
    let stopImmediatePropagation = false;
    let eventPhase = EventShimWithRealType.NONE;
    let target = null;
    let tmpTarget = null;
    let currentTarget = null;
    const originalStopPropagation = event.stopPropagation;
    const originalStopImmediatePropagation = event.stopImmediatePropagation;
    Object.defineProperties(event, {
      target: {
        get() {
          return target ?? tmpTarget;
        },
        ...enumerableProperty2
      },
      srcElement: {
        get() {
          return event.target;
        },
        ...enumerableProperty2
      },
      currentTarget: {
        get() {
          return currentTarget;
        },
        ...enumerableProperty2
      },
      eventPhase: {
        get() {
          return eventPhase;
        },
        ...enumerableProperty2
      },
      composedPath: {
        value: () => composedPath,
        ...enumerableProperty2
      },
      stopPropagation: {
        value: () => {
          stopPropagation = true;
          originalStopPropagation.call(event);
        },
        ...enumerableProperty2
      },
      stopImmediatePropagation: {
        value: () => {
          stopImmediatePropagation = true;
          originalStopImmediatePropagation.call(event);
        },
        ...enumerableProperty2
      }
    });
    const invokeEventListener = (listener, options, eventListenerMap) => {
      if (typeof listener === "function") {
        listener(event);
      } else if (typeof listener?.handleEvent === "function") {
        listener.handleEvent(event);
      }
      if (options.once) {
        eventListenerMap.delete(listener);
      }
    };
    const finishDispatch = () => {
      currentTarget = null;
      eventPhase = EventShimWithRealType.NONE;
      return !event.defaultPrevented;
    };
    const captureEventPath = composedPath.slice().reverse();
    target = !this.__host || !event.composed ? this : null;
    const retarget = (eventTargets) => {
      tmpTarget = this;
      while (tmpTarget.__host && eventTargets.includes(tmpTarget.__host)) {
        tmpTarget = tmpTarget.__host;
      }
    };
    for (const eventTarget of captureEventPath) {
      if (!target && (!tmpTarget || tmpTarget === eventTarget.__host)) {
        retarget(captureEventPath.slice(captureEventPath.indexOf(eventTarget)));
      }
      currentTarget = eventTarget;
      eventPhase = eventTarget === event.target ? EventShimWithRealType.AT_TARGET : EventShimWithRealType.CAPTURING_PHASE;
      const captureEventListeners = eventTarget.__captureEventListeners.get(event.type);
      if (captureEventListeners) {
        for (const [listener, options] of captureEventListeners) {
          invokeEventListener(listener, options, captureEventListeners);
          if (stopImmediatePropagation) {
            return finishDispatch();
          }
        }
      }
      if (stopPropagation) {
        return finishDispatch();
      }
    }
    const bubbleEventPath = event.bubbles ? composedPath : [this];
    tmpTarget = null;
    for (const eventTarget of bubbleEventPath) {
      if (!target && (!tmpTarget || eventTarget === tmpTarget.__host)) {
        retarget(bubbleEventPath.slice(0, bubbleEventPath.indexOf(eventTarget) + 1));
      }
      currentTarget = eventTarget;
      eventPhase = eventTarget === event.target ? EventShimWithRealType.AT_TARGET : EventShimWithRealType.BUBBLING_PHASE;
      const eventListeners = eventTarget.__eventListeners.get(event.type);
      if (eventListeners) {
        for (const [listener, options] of eventListeners) {
          invokeEventListener(listener, options, eventListeners);
          if (stopImmediatePropagation) {
            return finishDispatch();
          }
        }
      }
      if (stopPropagation) {
        return finishDispatch();
      }
    }
    return finishDispatch();
  }
  __resolveFullEventPath() {
    if (this.__eventPathCache) {
      return this.__eventPathCache;
    } else if (!this.__eventTargetParent) {
      return this.__eventPathCache = [this, documentShim, windowShim];
    } else {
      return this.__eventPathCache = [
        this,
        ...this.__eventTargetParent.__resolveFullEventPath()
      ];
    }
  }
};
var attributes = /* @__PURE__ */ new WeakMap();
var attributesForElement = (element) => {
  let attrs = attributes.get(element);
  if (attrs === void 0) {
    attributes.set(element, attrs = /* @__PURE__ */ new Map());
  }
  return attrs;
};
var NodeShim = class Node2 extends EventTarget {
  getRootNode(options) {
    if (options?.composed) {
      return document2;
    }
    const host = this.__host;
    return host?.__shadowRoot ?? document2;
  }
};
var DocumentShim = class Document2 extends NodeShim {
  get adoptedStyleSheets() {
    return [];
  }
  createTreeWalker() {
    return {};
  }
  createTextNode() {
    return {};
  }
  createElement() {
    return {};
  }
};
var documentShim = new DocumentShim();
var document2 = documentShim;
var WindowShim = class Window extends NodeShim {
  constructor(token) {
    super();
    if (token !== constructionToken) {
      throw new TypeError("Illegal constructor");
    }
    Object.assign(this, globalThis, {
      CustomElementRegistry,
      customElements: customElements2,
      document: document2,
      Document: DocumentShim,
      Element: ElementShim,
      EventTarget,
      HTMLElement: HTMLElementShim,
      Node: NodeShim,
      ShadowRoot: ShadowRootShim,
      window: this,
      Window: WindowShim
    });
  }
};
var ElementShim = class Element extends NodeShim {
  constructor() {
    super(...arguments);
    this.__shadowRootMode = null;
    this.__shadowRoot = null;
    this.__internals = null;
  }
  get attributes() {
    return Array.from(attributesForElement(this)).map(([name, value]) => ({
      name,
      value
    }));
  }
  get shadowRoot() {
    if (this.__shadowRootMode === "closed") {
      return null;
    }
    return this.__shadowRoot;
  }
  get localName() {
    return this.constructor.__localName;
  }
  get tagName() {
    return this.localName?.toUpperCase();
  }
  setAttribute(name, value) {
    attributesForElement(this).set(name, String(value));
  }
  removeAttribute(name) {
    attributesForElement(this).delete(name);
  }
  toggleAttribute(name, force) {
    if (this.hasAttribute(name)) {
      if (force === void 0 || !force) {
        this.removeAttribute(name);
        return false;
      }
    } else {
      if (force === void 0 || force) {
        this.setAttribute(name, "");
        return true;
      } else {
        return false;
      }
    }
    return true;
  }
  hasAttribute(name) {
    return attributesForElement(this).has(name);
  }
  attachShadow(init) {
    this.__shadowRootMode = init.mode;
    const shadowRoot = new ShadowRootShim(constructionToken, init);
    shadowRoot.__eventTargetParent = this;
    shadowRoot.__host = this;
    return this.__shadowRoot = shadowRoot;
  }
  attachInternals() {
    if (this.__internals !== null) {
      throw new Error(`Failed to execute 'attachInternals' on 'HTMLElement': ElementInternals for the specified element was already attached.`);
    }
    const internals = new ElementInternalsShim(this);
    this.__internals = internals;
    return internals;
  }
  getAttribute(name) {
    const value = attributesForElement(this).get(name);
    return value ?? null;
  }
};
var HTMLElementShim = class HTMLElement extends ElementShim {
};
var HTMLElementShimWithRealType = HTMLElementShim;
var ShadowRootShim = class ShadowRoot extends NodeShim {
  get host() {
    return this.__host;
  }
  constructor(constructionToken2, init) {
    super();
    if (constructionToken2 !== constructionToken2) {
      throw new TypeError("Illegal constructor");
    }
    this.mode = init.mode;
  }
};
globalThis.litServerRoot ??= Object.defineProperty(new HTMLElementShimWithRealType(), "localName", {
  // Patch localName (and tagName) to return a unique name.
  get() {
    return "lit-server-root";
  }
});
function promiseWithResolvers() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
var CustomElementRegistry = class {
  constructor() {
    this.__definitions = /* @__PURE__ */ new Map();
    this.__reverseDefinitions = /* @__PURE__ */ new Map();
    this.__pendingWhenDefineds = /* @__PURE__ */ new Map();
  }
  define(name, ctor) {
    if (this.__definitions.has(name)) {
      if (true) {
        console.warn(`'CustomElementRegistry' already has "${name}" defined. This may have been caused by live reload or hot module replacement in which case it can be safely ignored.
Make sure to test your application with a production build as repeat registrations will throw in production.`);
      } else {
        throw new Error(`Failed to execute 'define' on 'CustomElementRegistry': the name "${name}" has already been used with this registry`);
      }
    }
    if (this.__reverseDefinitions.has(ctor)) {
      throw new Error(`Failed to execute 'define' on 'CustomElementRegistry': the constructor has already been used with this registry for the tag name ${this.__reverseDefinitions.get(ctor)}`);
    }
    ctor.__localName = name;
    this.__definitions.set(name, {
      ctor,
      // Note it's important we read `observedAttributes` in case it is a getter
      // with side-effects, as is the case in Lit, where it triggers class
      // finalization.
      //
      // TODO(aomarks) To be spec compliant, we should also capture the
      // registration-time lifecycle methods like `connectedCallback`. For them
      // to be actually accessible to e.g. the Lit SSR element renderer, though,
      // we'd need to introduce a new API for accessing them (since `get` only
      // returns the constructor).
      observedAttributes: ctor.observedAttributes ?? []
    });
    this.__reverseDefinitions.set(ctor, name);
    this.__pendingWhenDefineds.get(name)?.resolve(ctor);
    this.__pendingWhenDefineds.delete(name);
  }
  get(name) {
    const definition = this.__definitions.get(name);
    return definition?.ctor;
  }
  getName(ctor) {
    return this.__reverseDefinitions.get(ctor) ?? null;
  }
  initialize(_root) {
    throw new Error(`customElements.initialize is not currently supported in SSR. Please file a bug if you need it.`);
  }
  upgrade(_element) {
    throw new Error(`customElements.upgrade is not currently supported in SSR. Please file a bug if you need it.`);
  }
  async whenDefined(name) {
    const definition = this.__definitions.get(name);
    if (definition) {
      return definition.ctor;
    }
    let withResolvers = this.__pendingWhenDefineds.get(name);
    if (!withResolvers) {
      withResolvers = promiseWithResolvers();
      this.__pendingWhenDefineds.set(name, withResolvers);
    }
    return withResolvers.promise;
  }
};
var CustomElementRegistryShimWithRealType = CustomElementRegistry;
var customElements2 = new CustomElementRegistryShimWithRealType();
var windowShim = new WindowShim(constructionToken);

// @lit/reactive-element/node/css-tag.js
var t = globalThis;
var e = t.ShadowRoot && (void 0 === t.ShadyCSS || t.ShadyCSS.nativeShadow) && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype;
var s = Symbol();
var o = /* @__PURE__ */ new WeakMap();
var n = class {
  constructor(t5, e5, o7) {
    if (this._$cssResult$ = true, o7 !== s) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
    this.cssText = t5, this.t = e5;
  }
  get styleSheet() {
    let t5 = this.o;
    const s5 = this.t;
    if (e && void 0 === t5) {
      const e5 = void 0 !== s5 && 1 === s5.length;
      e5 && (t5 = o.get(s5)), void 0 === t5 && ((this.o = t5 = new CSSStyleSheet()).replaceSync(this.cssText), e5 && o.set(s5, t5));
    }
    return t5;
  }
  toString() {
    return this.cssText;
  }
};
var r = (t5) => new n("string" == typeof t5 ? t5 : t5 + "", void 0, s);
var i = (t5, ...e5) => {
  const o7 = 1 === t5.length ? t5[0] : e5.reduce((e6, s5, o8) => e6 + ((t6) => {
    if (true === t6._$cssResult$) return t6.cssText;
    if ("number" == typeof t6) return t6;
    throw Error("Value passed to 'css' function must be a 'css' function result: " + t6 + ". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.");
  })(s5) + t5[o8 + 1], t5[0]);
  return new n(o7, t5, s);
};
var S = (s5, o7) => {
  if (e) s5.adoptedStyleSheets = o7.map((t5) => t5 instanceof CSSStyleSheet ? t5 : t5.styleSheet);
  else for (const e5 of o7) {
    const o8 = document.createElement("style"), n6 = t.litNonce;
    void 0 !== n6 && o8.setAttribute("nonce", n6), o8.textContent = e5.cssText, s5.appendChild(o8);
  }
};
var c = e || void 0 === t.CSSStyleSheet ? (t5) => t5 : (t5) => t5 instanceof CSSStyleSheet ? ((t6) => {
  let e5 = "";
  for (const s5 of t6.cssRules) e5 += s5.cssText;
  return r(e5);
})(t5) : t5;

// @lit/reactive-element/node/reactive-element.js
var { is: h, defineProperty: r2, getOwnPropertyDescriptor: o2, getOwnPropertyNames: n2, getOwnPropertySymbols: a, getPrototypeOf: c2 } = Object;
var l = globalThis;
l.customElements ??= customElements2;
var p = l.trustedTypes;
var d = p ? p.emptyScript : "";
var u = l.reactiveElementPolyfillSupport;
var f = (t5, s5) => t5;
var b = { toAttribute(t5, s5) {
  switch (s5) {
    case Boolean:
      t5 = t5 ? d : null;
      break;
    case Object:
    case Array:
      t5 = null == t5 ? t5 : JSON.stringify(t5);
  }
  return t5;
}, fromAttribute(t5, s5) {
  let i7 = t5;
  switch (s5) {
    case Boolean:
      i7 = null !== t5;
      break;
    case Number:
      i7 = null === t5 ? null : Number(t5);
      break;
    case Object:
    case Array:
      try {
        i7 = JSON.parse(t5);
      } catch (t6) {
        i7 = null;
      }
  }
  return i7;
} };
var m = (t5, s5) => !h(t5, s5);
var y = { attribute: true, type: String, converter: b, reflect: false, useDefault: false, hasChanged: m };
Symbol.metadata ??= Symbol("metadata"), l.litPropertyMetadata ??= /* @__PURE__ */ new WeakMap();
var g = class extends (globalThis.HTMLElement ?? HTMLElementShimWithRealType) {
  static addInitializer(t5) {
    this._$Ei(), (this.l ??= []).push(t5);
  }
  static get observedAttributes() {
    return this.finalize(), this._$Eh && [...this._$Eh.keys()];
  }
  static createProperty(t5, s5 = y) {
    if (s5.state && (s5.attribute = false), this._$Ei(), this.prototype.hasOwnProperty(t5) && ((s5 = Object.create(s5)).wrapped = true), this.elementProperties.set(t5, s5), !s5.noAccessor) {
      const i7 = Symbol(), e5 = this.getPropertyDescriptor(t5, i7, s5);
      void 0 !== e5 && r2(this.prototype, t5, e5);
    }
  }
  static getPropertyDescriptor(t5, s5, i7) {
    const { get: e5, set: h4 } = o2(this.prototype, t5) ?? { get() {
      return this[s5];
    }, set(t6) {
      this[s5] = t6;
    } };
    return { get: e5, set(s6) {
      const r6 = e5?.call(this);
      h4?.call(this, s6), this.requestUpdate(t5, r6, i7);
    }, configurable: true, enumerable: true };
  }
  static getPropertyOptions(t5) {
    return this.elementProperties.get(t5) ?? y;
  }
  static _$Ei() {
    if (this.hasOwnProperty(f("elementProperties"))) return;
    const t5 = c2(this);
    t5.finalize(), void 0 !== t5.l && (this.l = [...t5.l]), this.elementProperties = new Map(t5.elementProperties);
  }
  static finalize() {
    if (this.hasOwnProperty(f("finalized"))) return;
    if (this.finalized = true, this._$Ei(), this.hasOwnProperty(f("properties"))) {
      const t6 = this.properties, s5 = [...n2(t6), ...a(t6)];
      for (const i7 of s5) this.createProperty(i7, t6[i7]);
    }
    const t5 = this[Symbol.metadata];
    if (null !== t5) {
      const s5 = litPropertyMetadata.get(t5);
      if (void 0 !== s5) for (const [t6, i7] of s5) this.elementProperties.set(t6, i7);
    }
    this._$Eh = /* @__PURE__ */ new Map();
    for (const [t6, s5] of this.elementProperties) {
      const i7 = this._$Eu(t6, s5);
      void 0 !== i7 && this._$Eh.set(i7, t6);
    }
    this.elementStyles = this.finalizeStyles(this.styles);
  }
  static finalizeStyles(t5) {
    const s5 = [];
    if (Array.isArray(t5)) {
      const e5 = new Set(t5.flat(1 / 0).reverse());
      for (const t6 of e5) s5.unshift(c(t6));
    } else void 0 !== t5 && s5.push(c(t5));
    return s5;
  }
  static _$Eu(t5, s5) {
    const i7 = s5.attribute;
    return false === i7 ? void 0 : "string" == typeof i7 ? i7 : "string" == typeof t5 ? t5.toLowerCase() : void 0;
  }
  constructor() {
    super(), this._$Ep = void 0, this.isUpdatePending = false, this.hasUpdated = false, this._$Em = null, this._$Ev();
  }
  _$Ev() {
    this._$ES = new Promise((t5) => this.enableUpdating = t5), this._$AL = /* @__PURE__ */ new Map(), this._$E_(), this.requestUpdate(), this.constructor.l?.forEach((t5) => t5(this));
  }
  addController(t5) {
    (this._$EO ??= /* @__PURE__ */ new Set()).add(t5), void 0 !== this.renderRoot && this.isConnected && t5.hostConnected?.();
  }
  removeController(t5) {
    this._$EO?.delete(t5);
  }
  _$E_() {
    const t5 = /* @__PURE__ */ new Map(), s5 = this.constructor.elementProperties;
    for (const i7 of s5.keys()) this.hasOwnProperty(i7) && (t5.set(i7, this[i7]), delete this[i7]);
    t5.size > 0 && (this._$Ep = t5);
  }
  createRenderRoot() {
    const t5 = this.shadowRoot ?? this.attachShadow(this.constructor.shadowRootOptions);
    return S(t5, this.constructor.elementStyles), t5;
  }
  connectedCallback() {
    this.renderRoot ??= this.createRenderRoot(), this.enableUpdating(true), this._$EO?.forEach((t5) => t5.hostConnected?.());
  }
  enableUpdating(t5) {
  }
  disconnectedCallback() {
    this._$EO?.forEach((t5) => t5.hostDisconnected?.());
  }
  attributeChangedCallback(t5, s5, i7) {
    this._$AK(t5, i7);
  }
  _$ET(t5, s5) {
    const i7 = this.constructor.elementProperties.get(t5), e5 = this.constructor._$Eu(t5, i7);
    if (void 0 !== e5 && true === i7.reflect) {
      const h4 = (void 0 !== i7.converter?.toAttribute ? i7.converter : b).toAttribute(s5, i7.type);
      this._$Em = t5, null == h4 ? this.removeAttribute(e5) : this.setAttribute(e5, h4), this._$Em = null;
    }
  }
  _$AK(t5, s5) {
    const i7 = this.constructor, e5 = i7._$Eh.get(t5);
    if (void 0 !== e5 && this._$Em !== e5) {
      const t6 = i7.getPropertyOptions(e5), h4 = "function" == typeof t6.converter ? { fromAttribute: t6.converter } : void 0 !== t6.converter?.fromAttribute ? t6.converter : b;
      this._$Em = e5;
      const r6 = h4.fromAttribute(s5, t6.type);
      this[e5] = r6 ?? this._$Ej?.get(e5) ?? r6, this._$Em = null;
    }
  }
  requestUpdate(t5, s5, i7, e5 = false, h4) {
    if (void 0 !== t5) {
      const r6 = this.constructor;
      if (false === e5 && (h4 = this[t5]), i7 ??= r6.getPropertyOptions(t5), !((i7.hasChanged ?? m)(h4, s5) || i7.useDefault && i7.reflect && h4 === this._$Ej?.get(t5) && !this.hasAttribute(r6._$Eu(t5, i7)))) return;
      this.C(t5, s5, i7);
    }
    false === this.isUpdatePending && (this._$ES = this._$EP());
  }
  C(t5, s5, { useDefault: i7, reflect: e5, wrapped: h4 }, r6) {
    i7 && !(this._$Ej ??= /* @__PURE__ */ new Map()).has(t5) && (this._$Ej.set(t5, r6 ?? s5 ?? this[t5]), true !== h4 || void 0 !== r6) || (this._$AL.has(t5) || (this.hasUpdated || i7 || (s5 = void 0), this._$AL.set(t5, s5)), true === e5 && this._$Em !== t5 && (this._$Eq ??= /* @__PURE__ */ new Set()).add(t5));
  }
  async _$EP() {
    this.isUpdatePending = true;
    try {
      await this._$ES;
    } catch (t6) {
      Promise.reject(t6);
    }
    const t5 = this.scheduleUpdate();
    return null != t5 && await t5, !this.isUpdatePending;
  }
  scheduleUpdate() {
    return this.performUpdate();
  }
  performUpdate() {
    if (!this.isUpdatePending) return;
    if (!this.hasUpdated) {
      if (this.renderRoot ??= this.createRenderRoot(), this._$Ep) {
        for (const [t7, s6] of this._$Ep) this[t7] = s6;
        this._$Ep = void 0;
      }
      const t6 = this.constructor.elementProperties;
      if (t6.size > 0) for (const [s6, i7] of t6) {
        const { wrapped: t7 } = i7, e5 = this[s6];
        true !== t7 || this._$AL.has(s6) || void 0 === e5 || this.C(s6, void 0, i7, e5);
      }
    }
    let t5 = false;
    const s5 = this._$AL;
    try {
      t5 = this.shouldUpdate(s5), t5 ? (this.willUpdate(s5), this._$EO?.forEach((t6) => t6.hostUpdate?.()), this.update(s5)) : this._$EM();
    } catch (s6) {
      throw t5 = false, this._$EM(), s6;
    }
    t5 && this._$AE(s5);
  }
  willUpdate(t5) {
  }
  _$AE(t5) {
    this._$EO?.forEach((t6) => t6.hostUpdated?.()), this.hasUpdated || (this.hasUpdated = true, this.firstUpdated(t5)), this.updated(t5);
  }
  _$EM() {
    this._$AL = /* @__PURE__ */ new Map(), this.isUpdatePending = false;
  }
  get updateComplete() {
    return this.getUpdateComplete();
  }
  getUpdateComplete() {
    return this._$ES;
  }
  shouldUpdate(t5) {
    return true;
  }
  update(t5) {
    this._$Eq &&= this._$Eq.forEach((t6) => this._$ET(t6, this[t6])), this._$EM();
  }
  updated(t5) {
  }
  firstUpdated(t5) {
  }
};
g.elementStyles = [], g.shadowRootOptions = { mode: "open" }, g[f("elementProperties")] = /* @__PURE__ */ new Map(), g[f("finalized")] = /* @__PURE__ */ new Map(), u?.({ ReactiveElement: g }), (l.reactiveElementVersions ??= []).push("2.1.2");

// lit-html/lit-html.js
var t2 = globalThis;
var i2 = (t5) => t5;
var s2 = t2.trustedTypes;
var e2 = s2 ? s2.createPolicy("lit-html", { createHTML: (t5) => t5 }) : void 0;
var h2 = "$lit$";
var o3 = `lit$${Math.random().toFixed(9).slice(2)}$`;
var n3 = "?" + o3;
var r3 = `<${n3}>`;
var l2 = document;
var c3 = () => l2.createComment("");
var a2 = (t5) => null === t5 || "object" != typeof t5 && "function" != typeof t5;
var u2 = Array.isArray;
var d2 = (t5) => u2(t5) || "function" == typeof t5?.[Symbol.iterator];
var f2 = "[ 	\n\f\r]";
var v = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g;
var _ = /-->/g;
var m2 = />/g;
var p2 = RegExp(`>|${f2}(?:([^\\s"'>=/]+)(${f2}*=${f2}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`, "g");
var g2 = /'/g;
var $ = /"/g;
var y2 = /^(?:script|style|textarea|title)$/i;
var x = (t5) => (i7, ...s5) => ({ _$litType$: t5, strings: i7, values: s5 });
var b2 = x(1);
var w = x(2);
var T = x(3);
var E = Symbol.for("lit-noChange");
var A = Symbol.for("lit-nothing");
var C = /* @__PURE__ */ new WeakMap();
var P = l2.createTreeWalker(l2, 129);
function V(t5, i7) {
  if (!u2(t5) || !t5.hasOwnProperty("raw")) throw Error("invalid template strings array");
  return void 0 !== e2 ? e2.createHTML(i7) : i7;
}
var N = (t5, i7) => {
  const s5 = t5.length - 1, e5 = [];
  let n6, l3 = 2 === i7 ? "<svg>" : 3 === i7 ? "<math>" : "", c5 = v;
  for (let i8 = 0; i8 < s5; i8++) {
    const s6 = t5[i8];
    let a3, u5, d3 = -1, f3 = 0;
    for (; f3 < s6.length && (c5.lastIndex = f3, u5 = c5.exec(s6), null !== u5); ) f3 = c5.lastIndex, c5 === v ? "!--" === u5[1] ? c5 = _ : void 0 !== u5[1] ? c5 = m2 : void 0 !== u5[2] ? (y2.test(u5[2]) && (n6 = RegExp("</" + u5[2], "g")), c5 = p2) : void 0 !== u5[3] && (c5 = p2) : c5 === p2 ? ">" === u5[0] ? (c5 = n6 ?? v, d3 = -1) : void 0 === u5[1] ? d3 = -2 : (d3 = c5.lastIndex - u5[2].length, a3 = u5[1], c5 = void 0 === u5[3] ? p2 : '"' === u5[3] ? $ : g2) : c5 === $ || c5 === g2 ? c5 = p2 : c5 === _ || c5 === m2 ? c5 = v : (c5 = p2, n6 = void 0);
    const x2 = c5 === p2 && t5[i8 + 1].startsWith("/>") ? " " : "";
    l3 += c5 === v ? s6 + r3 : d3 >= 0 ? (e5.push(a3), s6.slice(0, d3) + h2 + s6.slice(d3) + o3 + x2) : s6 + o3 + (-2 === d3 ? i8 : x2);
  }
  return [V(t5, l3 + (t5[s5] || "<?>") + (2 === i7 ? "</svg>" : 3 === i7 ? "</math>" : "")), e5];
};
var S2 = class _S {
  constructor({ strings: t5, _$litType$: i7 }, e5) {
    let r6;
    this.parts = [];
    let l3 = 0, a3 = 0;
    const u5 = t5.length - 1, d3 = this.parts, [f3, v3] = N(t5, i7);
    if (this.el = _S.createElement(f3, e5), P.currentNode = this.el.content, 2 === i7 || 3 === i7) {
      const t6 = this.el.content.firstChild;
      t6.replaceWith(...t6.childNodes);
    }
    for (; null !== (r6 = P.nextNode()) && d3.length < u5; ) {
      if (1 === r6.nodeType) {
        if (r6.hasAttributes()) for (const t6 of r6.getAttributeNames()) if (t6.endsWith(h2)) {
          const i8 = v3[a3++], s5 = r6.getAttribute(t6).split(o3), e6 = /([.?@])?(.*)/.exec(i8);
          d3.push({ type: 1, index: l3, name: e6[2], strings: s5, ctor: "." === e6[1] ? I : "?" === e6[1] ? L : "@" === e6[1] ? z : H }), r6.removeAttribute(t6);
        } else t6.startsWith(o3) && (d3.push({ type: 6, index: l3 }), r6.removeAttribute(t6));
        if (y2.test(r6.tagName)) {
          const t6 = r6.textContent.split(o3), i8 = t6.length - 1;
          if (i8 > 0) {
            r6.textContent = s2 ? s2.emptyScript : "";
            for (let s5 = 0; s5 < i8; s5++) r6.append(t6[s5], c3()), P.nextNode(), d3.push({ type: 2, index: ++l3 });
            r6.append(t6[i8], c3());
          }
        }
      } else if (8 === r6.nodeType) if (r6.data === n3) d3.push({ type: 2, index: l3 });
      else {
        let t6 = -1;
        for (; -1 !== (t6 = r6.data.indexOf(o3, t6 + 1)); ) d3.push({ type: 7, index: l3 }), t6 += o3.length - 1;
      }
      l3++;
    }
  }
  static createElement(t5, i7) {
    const s5 = l2.createElement("template");
    return s5.innerHTML = t5, s5;
  }
};
function M(t5, i7, s5 = t5, e5) {
  if (i7 === E) return i7;
  let h4 = void 0 !== e5 ? s5._$Co?.[e5] : s5._$Cl;
  const o7 = a2(i7) ? void 0 : i7._$litDirective$;
  return h4?.constructor !== o7 && (h4?._$AO?.(false), void 0 === o7 ? h4 = void 0 : (h4 = new o7(t5), h4._$AT(t5, s5, e5)), void 0 !== e5 ? (s5._$Co ??= [])[e5] = h4 : s5._$Cl = h4), void 0 !== h4 && (i7 = M(t5, h4._$AS(t5, i7.values), h4, e5)), i7;
}
var R = class {
  constructor(t5, i7) {
    this._$AV = [], this._$AN = void 0, this._$AD = t5, this._$AM = i7;
  }
  get parentNode() {
    return this._$AM.parentNode;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  u(t5) {
    const { el: { content: i7 }, parts: s5 } = this._$AD, e5 = (t5?.creationScope ?? l2).importNode(i7, true);
    P.currentNode = e5;
    let h4 = P.nextNode(), o7 = 0, n6 = 0, r6 = s5[0];
    for (; void 0 !== r6; ) {
      if (o7 === r6.index) {
        let i8;
        2 === r6.type ? i8 = new k(h4, h4.nextSibling, this, t5) : 1 === r6.type ? i8 = new r6.ctor(h4, r6.name, r6.strings, this, t5) : 6 === r6.type && (i8 = new Z(h4, this, t5)), this._$AV.push(i8), r6 = s5[++n6];
      }
      o7 !== r6?.index && (h4 = P.nextNode(), o7++);
    }
    return P.currentNode = l2, e5;
  }
  p(t5) {
    let i7 = 0;
    for (const s5 of this._$AV) void 0 !== s5 && (void 0 !== s5.strings ? (s5._$AI(t5, s5, i7), i7 += s5.strings.length - 2) : s5._$AI(t5[i7])), i7++;
  }
};
var k = class _k {
  get _$AU() {
    return this._$AM?._$AU ?? this._$Cv;
  }
  constructor(t5, i7, s5, e5) {
    this.type = 2, this._$AH = A, this._$AN = void 0, this._$AA = t5, this._$AB = i7, this._$AM = s5, this.options = e5, this._$Cv = e5?.isConnected ?? true;
  }
  get parentNode() {
    let t5 = this._$AA.parentNode;
    const i7 = this._$AM;
    return void 0 !== i7 && 11 === t5?.nodeType && (t5 = i7.parentNode), t5;
  }
  get startNode() {
    return this._$AA;
  }
  get endNode() {
    return this._$AB;
  }
  _$AI(t5, i7 = this) {
    t5 = M(this, t5, i7), a2(t5) ? t5 === A || null == t5 || "" === t5 ? (this._$AH !== A && this._$AR(), this._$AH = A) : t5 !== this._$AH && t5 !== E && this._(t5) : void 0 !== t5._$litType$ ? this.$(t5) : void 0 !== t5.nodeType ? this.T(t5) : d2(t5) ? this.k(t5) : this._(t5);
  }
  O(t5) {
    return this._$AA.parentNode.insertBefore(t5, this._$AB);
  }
  T(t5) {
    this._$AH !== t5 && (this._$AR(), this._$AH = this.O(t5));
  }
  _(t5) {
    this._$AH !== A && a2(this._$AH) ? this._$AA.nextSibling.data = t5 : this.T(l2.createTextNode(t5)), this._$AH = t5;
  }
  $(t5) {
    const { values: i7, _$litType$: s5 } = t5, e5 = "number" == typeof s5 ? this._$AC(t5) : (void 0 === s5.el && (s5.el = S2.createElement(V(s5.h, s5.h[0]), this.options)), s5);
    if (this._$AH?._$AD === e5) this._$AH.p(i7);
    else {
      const t6 = new R(e5, this), s6 = t6.u(this.options);
      t6.p(i7), this.T(s6), this._$AH = t6;
    }
  }
  _$AC(t5) {
    let i7 = C.get(t5.strings);
    return void 0 === i7 && C.set(t5.strings, i7 = new S2(t5)), i7;
  }
  k(t5) {
    u2(this._$AH) || (this._$AH = [], this._$AR());
    const i7 = this._$AH;
    let s5, e5 = 0;
    for (const h4 of t5) e5 === i7.length ? i7.push(s5 = new _k(this.O(c3()), this.O(c3()), this, this.options)) : s5 = i7[e5], s5._$AI(h4), e5++;
    e5 < i7.length && (this._$AR(s5 && s5._$AB.nextSibling, e5), i7.length = e5);
  }
  _$AR(t5 = this._$AA.nextSibling, s5) {
    for (this._$AP?.(false, true, s5); t5 !== this._$AB; ) {
      const s6 = i2(t5).nextSibling;
      i2(t5).remove(), t5 = s6;
    }
  }
  setConnected(t5) {
    void 0 === this._$AM && (this._$Cv = t5, this._$AP?.(t5));
  }
};
var H = class {
  get tagName() {
    return this.element.tagName;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  constructor(t5, i7, s5, e5, h4) {
    this.type = 1, this._$AH = A, this._$AN = void 0, this.element = t5, this.name = i7, this._$AM = e5, this.options = h4, s5.length > 2 || "" !== s5[0] || "" !== s5[1] ? (this._$AH = Array(s5.length - 1).fill(new String()), this.strings = s5) : this._$AH = A;
  }
  _$AI(t5, i7 = this, s5, e5) {
    const h4 = this.strings;
    let o7 = false;
    if (void 0 === h4) t5 = M(this, t5, i7, 0), o7 = !a2(t5) || t5 !== this._$AH && t5 !== E, o7 && (this._$AH = t5);
    else {
      const e6 = t5;
      let n6, r6;
      for (t5 = h4[0], n6 = 0; n6 < h4.length - 1; n6++) r6 = M(this, e6[s5 + n6], i7, n6), r6 === E && (r6 = this._$AH[n6]), o7 ||= !a2(r6) || r6 !== this._$AH[n6], r6 === A ? t5 = A : t5 !== A && (t5 += (r6 ?? "") + h4[n6 + 1]), this._$AH[n6] = r6;
    }
    o7 && !e5 && this.j(t5);
  }
  j(t5) {
    t5 === A ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, t5 ?? "");
  }
};
var I = class extends H {
  constructor() {
    super(...arguments), this.type = 3;
  }
  j(t5) {
    this.element[this.name] = t5 === A ? void 0 : t5;
  }
};
var L = class extends H {
  constructor() {
    super(...arguments), this.type = 4;
  }
  j(t5) {
    this.element.toggleAttribute(this.name, !!t5 && t5 !== A);
  }
};
var z = class extends H {
  constructor(t5, i7, s5, e5, h4) {
    super(t5, i7, s5, e5, h4), this.type = 5;
  }
  _$AI(t5, i7 = this) {
    if ((t5 = M(this, t5, i7, 0) ?? A) === E) return;
    const s5 = this._$AH, e5 = t5 === A && s5 !== A || t5.capture !== s5.capture || t5.once !== s5.once || t5.passive !== s5.passive, h4 = t5 !== A && (s5 === A || e5);
    e5 && this.element.removeEventListener(this.name, this, s5), h4 && this.element.addEventListener(this.name, this, t5), this._$AH = t5;
  }
  handleEvent(t5) {
    "function" == typeof this._$AH ? this._$AH.call(this.options?.host ?? this.element, t5) : this._$AH.handleEvent(t5);
  }
};
var Z = class {
  constructor(t5, i7, s5) {
    this.element = t5, this.type = 6, this._$AN = void 0, this._$AM = i7, this.options = s5;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AI(t5) {
    M(this, t5);
  }
};
var j = { M: h2, P: o3, A: n3, C: 1, L: N, R, D: d2, V: M, I: k, H, N: L, U: z, B: I, F: Z };
var B = t2.litHtmlPolyfillSupport;
B?.(S2, k), (t2.litHtmlVersions ??= []).push("3.3.3");
var D = (t5, i7, s5) => {
  const e5 = s5?.renderBefore ?? i7;
  let h4 = e5._$litPart$;
  if (void 0 === h4) {
    const t6 = s5?.renderBefore ?? null;
    e5._$litPart$ = h4 = new k(i7.insertBefore(c3(), t6), t6, void 0, s5 ?? {});
  }
  return h4._$AI(t5), h4;
};

// lit-element/lit-element.js
var s3 = globalThis;
var i3 = class extends g {
  constructor() {
    super(...arguments), this.renderOptions = { host: this }, this._$Do = void 0;
  }
  createRenderRoot() {
    const t5 = super.createRenderRoot();
    return this.renderOptions.renderBefore ??= t5.firstChild, t5;
  }
  update(t5) {
    const r6 = this.render();
    this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(t5), this._$Do = D(r6, this.renderRoot, this.renderOptions);
  }
  connectedCallback() {
    super.connectedCallback(), this._$Do?.setConnected(true);
  }
  disconnectedCallback() {
    super.disconnectedCallback(), this._$Do?.setConnected(false);
  }
  render() {
    return E;
  }
};
i3._$litElement$ = true, i3["finalized"] = true, s3.litElementHydrateSupport?.({ LitElement: i3 });
var o4 = s3.litElementPolyfillSupport;
o4?.({ LitElement: i3 });
(s3.litElementVersions ??= []).push("4.2.2");

// @lit/reactive-element/node/decorators/property.js
var o5 = { attribute: true, type: String, converter: b, reflect: false, hasChanged: m };
var r4 = (t5 = o5, e5, r6) => {
  const { kind: n6, metadata: i7 } = r6;
  let s5 = globalThis.litPropertyMetadata.get(i7);
  if (void 0 === s5 && globalThis.litPropertyMetadata.set(i7, s5 = /* @__PURE__ */ new Map()), "setter" === n6 && ((t5 = Object.create(t5)).wrapped = true), s5.set(r6.name, t5), "accessor" === n6) {
    const { name: o7 } = r6;
    return { set(r7) {
      const n7 = e5.get.call(this);
      e5.set.call(this, r7), this.requestUpdate(o7, n7, t5, true, r7);
    }, init(e6) {
      return void 0 !== e6 && this.C(o7, void 0, t5, e6), e6;
    } };
  }
  if ("setter" === n6) {
    const { name: o7 } = r6;
    return function(r7) {
      const n7 = this[o7];
      e5.call(this, r7), this.requestUpdate(o7, n7, t5, true, r7);
    };
  }
  throw Error("Unsupported decorator location: " + n6);
};
function n4(t5) {
  return (e5, o7) => "object" == typeof o7 ? r4(t5, e5, o7) : ((t6, e6, o8) => {
    const r6 = e6.hasOwnProperty(o8);
    return e6.constructor.createProperty(o8, t6), r6 ? Object.getOwnPropertyDescriptor(e6, o8) : void 0;
  })(t5, e5, o7);
}

// @lit/reactive-element/node/decorators/state.js
function r5(r6) {
  return n4({ ...r6, state: true, attribute: false });
}

// @erplora/outfitkit/dist/define.js
function define(tag, ctor) {
  if (typeof customElements !== "undefined" && !customElements.get(tag)) {
    customElements.define(tag, ctor);
  }
}

// @erplora/outfitkit/dist/shared/icons.js
var rawAdd = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M256 112v288m144-144H112"/></svg>';
var rawAlertCircle = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="currentColor" d="M256 48C141.31 48 48 141.31 48 256s93.31 208 208 208s208-93.31 208-208S370.69 48 256 48m0 319.91a20 20 0 1 1 20-20a20 20 0 0 1-20 20m21.72-201.15l-5.74 122a16 16 0 0 1-32 0l-5.74-121.94v-.05a21.74 21.74 0 1 1 43.44 0Z"/></svg>';
var rawAlertCircleOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-miterlimit="10" stroke-width="32" d="M448 256c0-106-86-192-192-192S64 150 64 256s86 192 192 192s192-86 192-192Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M250.26 166.05L256 288l5.73-121.95a5.74 5.74 0 0 0-5.79-6h0a5.74 5.74 0 0 0-5.68 6"/><path fill="currentColor" d="M256 367.91a20 20 0 1 1 20-20a20 20 0 0 1-20 20"/></svg>';
var rawAppsOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><rect width="80" height="80" x="64" y="64" fill="none" stroke="currentColor" stroke-miterlimit="10" stroke-width="32" rx="40" ry="40"/><rect width="80" height="80" x="216" y="64" fill="none" stroke="currentColor" stroke-miterlimit="10" stroke-width="32" rx="40" ry="40"/><rect width="80" height="80" x="368" y="64" fill="none" stroke="currentColor" stroke-miterlimit="10" stroke-width="32" rx="40" ry="40"/><rect width="80" height="80" x="64" y="216" fill="none" stroke="currentColor" stroke-miterlimit="10" stroke-width="32" rx="40" ry="40"/><rect width="80" height="80" x="216" y="216" fill="none" stroke="currentColor" stroke-miterlimit="10" stroke-width="32" rx="40" ry="40"/><rect width="80" height="80" x="368" y="216" fill="none" stroke="currentColor" stroke-miterlimit="10" stroke-width="32" rx="40" ry="40"/><rect width="80" height="80" x="64" y="368" fill="none" stroke="currentColor" stroke-miterlimit="10" stroke-width="32" rx="40" ry="40"/><rect width="80" height="80" x="216" y="368" fill="none" stroke="currentColor" stroke-miterlimit="10" stroke-width="32" rx="40" ry="40"/><rect width="80" height="80" x="368" y="368" fill="none" stroke="currentColor" stroke-miterlimit="10" stroke-width="32" rx="40" ry="40"/></svg>';
var rawArchiveOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M80 152v256a40.12 40.12 0 0 0 40 40h272a40.12 40.12 0 0 0 40-40V152"/><rect width="416" height="80" x="48" y="64" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="32" rx="28" ry="28"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="m320 304l-64 64l-64-64m64 41.89V224"/></svg>';
var rawArrowRedoOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="32" d="M448 256L272 88v96C103.57 184 64 304.77 64 424c48.61-62.24 91.6-96 208-96v96Z"/></svg>';
var rawArrowUndoOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="32" d="M240 424v-96c116.4 0 159.39 33.76 208 96c0-119.23-39.57-240-208-240V88L64 256Z"/></svg>';
var rawBackspaceOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="32" d="M135.19 390.14a28.8 28.8 0 0 0 21.68 9.86h246.26A29 29 0 0 0 432 371.13V140.87A29 29 0 0 0 403.13 112H156.87a28.84 28.84 0 0 0-21.67 9.84L46.33 256l88.86 134.11Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M336.67 192.33L206.66 322.34m130.01 0L206.66 192.33m130.01 0L206.66 322.34m130.01 0L206.66 192.33"/></svg>';
var rawCalendarOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><rect width="416" height="384" x="48" y="80" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="32" rx="48"/><circle cx="296" cy="232" r="24" fill="currentColor"/><circle cx="376" cy="232" r="24" fill="currentColor"/><circle cx="296" cy="312" r="24" fill="currentColor"/><circle cx="376" cy="312" r="24" fill="currentColor"/><circle cx="136" cy="312" r="24" fill="currentColor"/><circle cx="216" cy="312" r="24" fill="currentColor"/><circle cx="136" cy="392" r="24" fill="currentColor"/><circle cx="216" cy="392" r="24" fill="currentColor"/><circle cx="296" cy="392" r="24" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M128 48v32m256-32v32"/><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="32" d="M464 160H48"/></svg>';
var rawCheckmarkCircle = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="currentColor" d="M256 48C141.31 48 48 141.31 48 256s93.31 208 208 208s208-93.31 208-208S370.69 48 256 48m108.25 138.29l-134.4 160a16 16 0 0 1-12 5.71h-.27a16 16 0 0 1-11.89-5.3l-57.6-64a16 16 0 1 1 23.78-21.4l45.29 50.32l122.59-145.91a16 16 0 0 1 24.5 20.58"/></svg>';
var rawCheckmarkOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M416 128L192 384l-96-96"/></svg>';
var rawChevronBack = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="48" d="M328 112L184 256l144 144"/></svg>';
var rawChevronBackOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="48" d="M328 112L184 256l144 144"/></svg>';
var rawChevronDownOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="48" d="m112 184l144 144l144-144"/></svg>';
var rawChevronForward = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="48" d="m184 112l144 144l-144 144"/></svg>';
var rawChevronForwardOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="48" d="m184 112l144 144l-144 144"/></svg>';
var rawChevronUpOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="48" d="m112 328l144-144l144 144"/></svg>';
var rawClose = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="currentColor" d="m289.94 256l95-95A24 24 0 0 0 351 127l-95 95l-95-95a24 24 0 0 0-34 34l95 95l-95 95a24 24 0 1 0 34 34l95-95l95 95a24 24 0 0 0 34-34Z"/></svg>';
var rawCloseOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M368 368L144 144m224 0L144 368"/></svg>';
var rawCloudUploadOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M320 367.79h76c55 0 100-29.21 100-83.6s-53-81.47-96-83.6c-8.89-85.06-71-136.8-144-136.8c-69 0-113.44 45.79-128 91.2c-60 5.7-112 43.88-112 106.4s54 106.4 120 106.4h56"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="m320 255.79l-64-64l-64 64m64 192.42V207.79"/></svg>';
var rawCreateOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M384 224v184a40 40 0 0 1-40 40H104a40 40 0 0 1-40-40V168a40 40 0 0 1 40-40h167.48"/><path fill="currentColor" d="M459.94 53.25a16.06 16.06 0 0 0-23.22-.56L424.35 65a8 8 0 0 0 0 11.31l11.34 11.32a8 8 0 0 0 11.34 0l12.06-12c6.1-6.09 6.67-16.01.85-22.38M399.34 90L218.82 270.2a9 9 0 0 0-2.31 3.93L208.16 299a3.91 3.91 0 0 0 4.86 4.86l24.85-8.35a9 9 0 0 0 3.93-2.31L422 112.66a9 9 0 0 0 0-12.66l-9.95-10a9 9 0 0 0-12.71 0"/></svg>';
var rawContractOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M304 416V304h112m-101.8 10.23L432 432M208 96v112H96m101.8-10.23L80 80m336 128H304V96m10.23 101.8L432 80M96 304h112v112m-10.23-101.8L80 432"/></svg>';
var rawDocumentAttachOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M208 64h66.75a32 32 0 0 1 22.62 9.37l141.26 141.26a32 32 0 0 1 9.37 22.62V432a48 48 0 0 1-48 48H192a48 48 0 0 1-48-48V304"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M288 72v120a32 32 0 0 0 32 32h120"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-miterlimit="10" stroke-width="32" d="M160 80v152a23.69 23.69 0 0 1-24 24c-12 0-24-9.1-24-24V88c0-30.59 16.57-56 48-56s48 24.8 48 55.38v138.75c0 43-27.82 77.87-72 77.87s-72-34.86-72-77.87V144"/></svg>';
var rawDocumentOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="32" d="M416 221.25V416a48 48 0 0 1-48 48H144a48 48 0 0 1-48-48V96a48 48 0 0 1 48-48h98.75a32 32 0 0 1 22.62 9.37l141.26 141.26a32 32 0 0 1 9.37 22.62Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M256 56v120a32 32 0 0 0 32 32h120"/></svg>';
var rawDocumentTextOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="32" d="M416 221.25V416a48 48 0 0 1-48 48H144a48 48 0 0 1-48-48V96a48 48 0 0 1 48-48h98.75a32 32 0 0 1 22.62 9.37l141.26 141.26a32 32 0 0 1 9.37 22.62Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M256 56v120a32 32 0 0 0 32 32h120m-232 80h160m-160 80h160"/></svg>';
var rawDownloadOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M336 176h40a40 40 0 0 1 40 40v208a40 40 0 0 1-40 40H136a40 40 0 0 1-40-40V216a40 40 0 0 1 40-40h40"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="m176 272l80 80l80-80M256 48v288"/></svg>';
var rawEllipsisVertical = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><circle cx="256" cy="256" r="48" fill="currentColor"/><circle cx="256" cy="416" r="48" fill="currentColor"/><circle cx="256" cy="96" r="48" fill="currentColor"/></svg>';
var rawExpandOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M432 320v112H320m101.8-10.23L304 304M80 192V80h112M90.2 90.23L208 208M320 80h112v112M421.77 90.2L304 208M192 432H80V320m10.23 101.8L208 304"/></svg>';
var rawFileTrayOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="32" d="M384 80H128c-26 0-43 14-48 40L48 272v112a48.14 48.14 0 0 0 48 48h320a48.14 48.14 0 0 0 48-48V272l-32-152c-5-27-23-40-48-40Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M48 272h144m128 0h144m-272 0a64 64 0 0 0 128 0"/></svg>';
var rawFolderOpenOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M64 192v-72a40 40 0 0 1 40-40h75.89a40 40 0 0 1 22.19 6.72l27.84 18.56a40 40 0 0 0 22.19 6.72H408a40 40 0 0 1 40 40v40"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M479.9 226.55L463.68 392a40 40 0 0 1-39.93 40H88.25a40 40 0 0 1-39.93-40L32.1 226.55A32 32 0 0 1 64 192h384.1a32 32 0 0 1 31.8 34.55"/></svg>';
var rawInformationCircle = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="currentColor" d="M256 56C145.72 56 56 145.72 56 256s89.72 200 200 200s200-89.72 200-200S366.28 56 256 56m0 82a26 26 0 1 1-26 26a26 26 0 0 1 26-26m48 226h-88a16 16 0 0 1 0-32h28v-88h-16a16 16 0 0 1 0-32h32a16 16 0 0 1 16 16v104h28a16 16 0 0 1 0 32"/></svg>';
var rawMenuOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-miterlimit="10" stroke-width="32" d="M80 160h352M80 256h352M80 352h352"/></svg>';
var rawNotificationsOffOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M128.51 204.59q-.37 6.15-.37 12.76C128.14 304 110 320 84.33 351.43C73.69 364.45 83 384 101.62 384H320m94.5-48.7c-18.48-23.45-30.62-47.05-30.62-118c0-79.3-40.52-107.57-73.88-121.3c-4.43-1.82-8.6-6-9.95-10.55C294.21 65.54 277.82 48 256 48s-38.2 17.55-44 37.47c-1.35 4.6-5.52 8.71-10 10.53a150 150 0 0 0-18 8.79M320 384v16a64 64 0 0 1-128 0v-16"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-miterlimit="10" stroke-width="32" d="M448 448L64 64"/></svg>';
var rawOpenOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M384 224v184a40 40 0 0 1-40 40H104a40 40 0 0 1-40-40V168a40 40 0 0 1 40-40h167.48M336 64h112v112M224 288L440 72"/></svg>';
var rawPlayOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-miterlimit="10" stroke-width="32" d="M112 111v290c0 17.44 17 28.52 31 20.16l247.9-148.37c12.12-7.25 12.12-26.33 0-33.58L143 90.84c-14-8.36-31 2.72-31 20.16Z"/></svg>';
var rawRemove = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M400 256H112"/></svg>';
var rawSearchOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-miterlimit="10" stroke-width="32" d="M221.09 64a157.09 157.09 0 1 0 157.09 157.09A157.1 157.1 0 0 0 221.09 64Z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-miterlimit="10" stroke-width="32" d="M338.29 338.29L448 448"/></svg>';
var rawSend = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="currentColor" d="m476.59 227.05l-.16-.07L49.35 49.84A23.56 23.56 0 0 0 27.14 52A24.65 24.65 0 0 0 16 72.59v113.29a24 24 0 0 0 19.52 23.57l232.93 43.07a4 4 0 0 1 0 7.86L35.53 303.45A24 24 0 0 0 16 327v113.31A23.57 23.57 0 0 0 26.59 460a23.94 23.94 0 0 0 13.22 4a24.55 24.55 0 0 0 9.52-1.93L476.4 285.94l.19-.09a32 32 0 0 0 0-58.8"/></svg>';
var rawSwapVerticalOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M464 208L352 96L240 208m112-94.87V416M48 304l112 112l112-112m-112 94V96"/></svg>';
var rawTrashOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="m112 112l20 320c.95 18.49 14.4 32 32 32h184c17.67 0 30.87-13.51 32-32l20-320"/><path fill="currentColor" stroke="currentColor" stroke-linecap="round" stroke-miterlimit="10" stroke-width="32" d="M80 112h352"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M192 112V72h0a23.93 23.93 0 0 1 24-24h80a23.93 23.93 0 0 1 24 24h0v40m-64 64v224m-72-224l8 224m136-224l-8 224"/></svg>';
var rawTrendingDown = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M352 368h112V256"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="m48 144l121.37 121.37a32 32 0 0 0 45.26 0l50.74-50.74a32 32 0 0 1 45.26 0L448 352"/></svg>';
var rawTrendingUp = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M352 144h112v112"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="m48 368l121.37-121.37a32 32 0 0 1 45.26 0l50.74 50.74a32 32 0 0 0 45.26 0L448 160"/></svg>';
var rawVolumeHighOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M126 192H56a8 8 0 0 0-8 8v112a8 8 0 0 0 8 8h69.65a15.93 15.93 0 0 1 10.14 3.54l91.47 74.89A8 8 0 0 0 240 392V120a8 8 0 0 0-12.74-6.43l-91.47 74.89A15 15 0 0 1 126 192m194 128c9.74-19.38 16-40.84 16-64c0-23.48-6-44.42-16-64m48 176c19.48-33.92 32-64.06 32-112s-12-77.74-32-112m48 272c30-46 48-91.43 48-160s-18-113-48-160"/></svg>';
var rawVolumeLowOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M189.65 192H120a8 8 0 0 0-8 8v112a8 8 0 0 0 8 8h69.65a16 16 0 0 1 10.14 3.63l91.47 75a8 8 0 0 0 12.74-6.46V119.83a8 8 0 0 0-12.74-6.44l-91.47 75a16 16 0 0 1-10.14 3.61M384 320c9.74-19.41 16-40.81 16-64c0-23.51-6-44.4-16-64"/></svg>';
var rawVolumeMuteOutline = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-miterlimit="10" stroke-width="32" d="M416 432L64 80"/><path fill="currentColor" d="M224 136.92v33.8a4 4 0 0 0 1.17 2.82l24 24a4 4 0 0 0 6.83-2.82v-74.15a24.53 24.53 0 0 0-12.67-21.72a23.91 23.91 0 0 0-25.55 1.83a8 8 0 0 0-.66.51l-31.94 26.15a4 4 0 0 0-.29 5.92l17.05 17.06a4 4 0 0 0 5.37.26Zm0 238.16l-78.07-63.92a32 32 0 0 0-20.28-7.16H64v-96h50.72a4 4 0 0 0 2.82-6.83l-24-24a4 4 0 0 0-2.82-1.17H56a24 24 0 0 0-24 24v112a24 24 0 0 0 24 24h69.76l91.36 74.8a8 8 0 0 0 .66.51a23.93 23.93 0 0 0 25.85 1.69A24.49 24.49 0 0 0 256 391.45v-50.17a4 4 0 0 0-1.17-2.82l-24-24a4 4 0 0 0-6.83 2.82ZM352 256c0-24.56-5.81-47.88-17.75-71.27a16 16 0 0 0-28.5 14.54C315.34 218.06 320 236.62 320 256q0 4-.31 8.13a8 8 0 0 0 2.32 6.25l19.66 19.67a4 4 0 0 0 6.75-2A147 147 0 0 0 352 256m64 0c0-51.19-13.08-83.89-34.18-120.06a16 16 0 0 0-27.64 16.12C373.07 184.44 384 211.83 384 256c0 23.83-3.29 42.88-9.37 60.65a8 8 0 0 0 1.9 8.26l16.77 16.76a4 4 0 0 0 6.52-1.27C410.09 315.88 416 289.91 416 256"/><path fill="currentColor" d="M480 256c0-74.26-20.19-121.11-50.51-168.61a16 16 0 1 0-27 17.22C429.82 147.38 448 189.5 448 256c0 47.45-8.9 82.12-23.59 113a4 4 0 0 0 .77 4.55L443 391.39a4 4 0 0 0 6.4-1C470.88 348.22 480 307 480 256"/></svg>';
var rawWarning = '<svg viewBox="0 0 512 512" width="1.2em" height="1.2em" ><path fill="currentColor" d="M449.07 399.08L278.64 82.58c-12.08-22.44-44.26-22.44-56.35 0L51.87 399.08A32 32 0 0 0 80 446.25h340.89a32 32 0 0 0 28.18-47.17m-198.6-1.83a20 20 0 1 1 20-20a20 20 0 0 1-20 20m21.72-201.15l-5.74 122a16 16 0 0 1-32 0l-5.74-121.95a21.73 21.73 0 0 1 21.5-22.69h.21a21.74 21.74 0 0 1 21.73 22.7Z"/></svg>';
function bake(svg) {
  return `data:image/svg+xml;utf8,${svg}`;
}
var iconAdd = bake(rawAdd);
var iconAlertCircle = bake(rawAlertCircle);
var iconAlertCircleOutline = bake(rawAlertCircleOutline);
var iconAppsOutline = bake(rawAppsOutline);
var iconArchiveOutline = bake(rawArchiveOutline);
var iconArrowRedoOutline = bake(rawArrowRedoOutline);
var iconArrowUndoOutline = bake(rawArrowUndoOutline);
var iconBackspaceOutline = bake(rawBackspaceOutline);
var iconCalendarOutline = bake(rawCalendarOutline);
var iconCheckmarkCircle = bake(rawCheckmarkCircle);
var iconCheckmarkOutline = bake(rawCheckmarkOutline);
var iconChevronBack = bake(rawChevronBack);
var iconChevronBackOutline = bake(rawChevronBackOutline);
var iconChevronDownOutline = bake(rawChevronDownOutline);
var iconChevronForward = bake(rawChevronForward);
var iconChevronForwardOutline = bake(rawChevronForwardOutline);
var iconChevronUpOutline = bake(rawChevronUpOutline);
var iconClose = bake(rawClose);
var iconCloseOutline = bake(rawCloseOutline);
var iconCloudUploadOutline = bake(rawCloudUploadOutline);
var iconCreateOutline = bake(rawCreateOutline);
var iconDocumentAttachOutline = bake(rawDocumentAttachOutline);
var iconContractOutline = bake(rawContractOutline);
var iconDocumentOutline = bake(rawDocumentOutline);
var iconDocumentTextOutline = bake(rawDocumentTextOutline);
var iconDownloadOutline = bake(rawDownloadOutline);
var iconEllipsisVertical = bake(rawEllipsisVertical);
var iconExpandOutline = bake(rawExpandOutline);
var iconFileTrayOutline = bake(rawFileTrayOutline);
var iconFolderOpenOutline = bake(rawFolderOpenOutline);
var iconInformationCircle = bake(rawInformationCircle);
var iconMenuOutline = bake(rawMenuOutline);
var iconNotificationsOffOutline = bake(rawNotificationsOffOutline);
var iconOpenOutline = bake(rawOpenOutline);
var iconPlayOutline = bake(rawPlayOutline);
var iconRemove = bake(rawRemove);
var iconSearchOutline = bake(rawSearchOutline);
var iconSend = bake(rawSend);
var iconSwapVerticalOutline = bake(rawSwapVerticalOutline);
var iconTrashOutline = bake(rawTrashOutline);
var iconTrendingDown = bake(rawTrendingDown);
var iconTrendingUp = bake(rawTrendingUp);
var iconVolumeHighOutline = bake(rawVolumeHighOutline);
var iconVolumeLowOutline = bake(rawVolumeLowOutline);
var iconVolumeMuteOutline = bake(rawVolumeMuteOutline);
var iconWarning = bake(rawWarning);
var BY_NAME = {
  "add": iconAdd,
  "alert-circle": iconAlertCircle,
  "alert-circle-outline": iconAlertCircleOutline,
  "apps-outline": iconAppsOutline,
  "archive-outline": iconArchiveOutline,
  "arrow-redo-outline": iconArrowRedoOutline,
  "arrow-undo-outline": iconArrowUndoOutline,
  "backspace-outline": iconBackspaceOutline,
  "calendar-outline": iconCalendarOutline,
  "checkmark-circle": iconCheckmarkCircle,
  "checkmark-outline": iconCheckmarkOutline,
  "chevron-back": iconChevronBack,
  "chevron-back-outline": iconChevronBackOutline,
  "chevron-down-outline": iconChevronDownOutline,
  "chevron-forward": iconChevronForward,
  "chevron-forward-outline": iconChevronForwardOutline,
  "chevron-up-outline": iconChevronUpOutline,
  "close": iconClose,
  "close-outline": iconCloseOutline,
  "cloud-upload-outline": iconCloudUploadOutline,
  "create-outline": iconCreateOutline,
  "document-attach-outline": iconDocumentAttachOutline,
  "contract-outline": iconContractOutline,
  "document-outline": iconDocumentOutline,
  "document-text-outline": iconDocumentTextOutline,
  "download-outline": iconDownloadOutline,
  "ellipsis-vertical": iconEllipsisVertical,
  "expand-outline": iconExpandOutline,
  "file-tray-outline": iconFileTrayOutline,
  "folder-open-outline": iconFolderOpenOutline,
  "information-circle": iconInformationCircle,
  "menu-outline": iconMenuOutline,
  "notifications-off-outline": iconNotificationsOffOutline,
  "open-outline": iconOpenOutline,
  "play-outline": iconPlayOutline,
  "remove": iconRemove,
  "search-outline": iconSearchOutline,
  "send": iconSend,
  "swap-vertical-outline": iconSwapVerticalOutline,
  "trash-outline": iconTrashOutline,
  "trending-down": iconTrendingDown,
  "trending-up": iconTrendingUp,
  "volume-high-outline": iconVolumeHighOutline,
  "volume-low-outline": iconVolumeLowOutline,
  "volume-mute-outline": iconVolumeMuteOutline,
  "warning": iconWarning
};
function okIcon(value) {
  if (!value) return void 0;
  const trimmed = value.trimStart();
  if (trimmed.startsWith("<svg")) return bake(trimmed);
  return BY_NAME[value] ?? value;
}

// @erplora/outfitkit/dist/ok-inline-feedback.js
var __defProp2 = Object.defineProperty;
var __decorateClass2 = (decorators, target, key, kind) => {
  var result = void 0;
  for (var i7 = decorators.length - 1, decorator; i7 >= 0; i7--)
    if (decorator = decorators[i7])
      result = decorator(target, key, result) || result;
  if (result) __defProp2(target, key, result);
  return result;
};
var DEFAULT_LABELS = {
  dismiss: "Dismiss"
};
var OkInlineFeedback = class extends i3 {
  constructor() {
    super(...arguments);
    this.tone = "info";
    this.dismissible = false;
    this.hidden = false;
    this.labels = {};
    this.hasActions = false;
    this.onActionsSlotChange = (e5) => {
      const slot = e5.target;
      this.hasActions = slot.assignedNodes({ flatten: true }).length > 0;
    };
  }
  static {
    this.styles = i`
    :host {
      /* Vars overridable (estilo Ionic), default = cadena --ok-* → --ion-* → hex.
         --tone-color y --tone-icon se reasignan por tone abajo. */
      --tone-color: var(--ok-primary, var(--ion-color-primary, #3880ff));
      --background-opacity: 0.1;
      --color: var(--ok-text, var(--ion-text-color, #1c1b17));
      --border-radius: var(--ok-radius, var(--ion-border-radius, 8px));
      --padding: var(--ok-spacing, var(--ion-padding, 16px));
      --accent-width: 4px;
      --font: var(--ok-font, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);

      /* Responsive: el banner ocupa el ancho del contenedor. */
      display: block;
      width: 100%;
      font-family: var(--font);
      box-sizing: border-box;
    }
    :host([hidden]) { display: none; }

    /* Mapa de tonos → color Ionic + icono por defecto. */
    :host([tone='success']) { --tone-color: var(--ok-success, var(--ion-color-success, #2dd55b)); }
    :host([tone='warning']) { --tone-color: var(--ok-warning, var(--ion-color-warning, #ffc409)); }
    :host([tone='danger'])  { --tone-color: var(--ok-danger, var(--ion-color-danger, #c5000f)); }
    :host([tone='neutral']) { --tone-color: var(--ok-medium, var(--ion-color-medium, #5f5f5f)); }
    /* info / sin tono → primary (default ya aplicado en :host). */

    .box {
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: var(--padding);
      border-radius: var(--border-radius);
      border-inline-start: var(--accent-width) solid var(--tone-color);
      /* Fondo tonal: el color del tono con baja opacidad (color-mix con fallback al borde fino). */
      background: color-mix(in srgb, var(--tone-color) calc(var(--background-opacity) * 100%), transparent);
      color: var(--color);
    }

    .icon {
      flex: 0 0 auto;
      font-size: 1.4rem;
      line-height: 1;
      color: var(--tone-color);
      margin-top: 0.05rem;
    }

    .content {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .row {
      display: flex;
      align-items: flex-start;
      gap: 1rem;
    }
    .text {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .heading {
      font-weight: 700;
      font-size: 0.98rem;
      line-height: 1.3;
    }
    .body {
      font-size: 0.92rem;
      line-height: 1.45;
    }
    .actions {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    /* Si no hay actions, el slot queda vacío y no ocupa espacio. */
    .actions.empty { display: none; }

    .close {
      flex: 0 0 auto;
      background: none;
      border: 0;
      cursor: pointer;
      padding: 0.15rem;
      margin: -0.15rem -0.15rem 0 0;
      color: inherit;
      opacity: 0.6;
      font-size: 1.2rem;
      line-height: 1;
      border-radius: 4px;
      transition: background-color var(--ok-transition, 150ms ease), color var(--ok-transition, 150ms ease),
        border-color var(--ok-transition, 150ms ease), box-shadow var(--ok-transition, 150ms ease),
        opacity 0.15s ease, transform 120ms ease;
    }
    @media (hover: hover) {
      .close:hover { opacity: 1; background: rgba(var(--ion-text-color-rgb, 24, 24, 27), 0.07); }
    }
    .close:active { transform: scale(var(--ok-press-scale, 0.97)); }

    /* Móvil: las actions bajan bajo el texto (apiladas a ancho completo). */
    @media (max-width: 640px) {
      .row { flex-direction: column; align-items: stretch; }
      .actions { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) {
      .close:hover,
      .close:active { transform: none; }
    }
  `;
  }
  // Textos efectivos: defaults en inglés + overrides del consumidor.
  get t() {
    return { ...DEFAULT_LABELS, ...this.labels };
  }
  // Icono por defecto según el tono (overridable por la prop `icon`).
  defaultIcon() {
    switch (this.tone) {
      case "success":
        return iconCheckmarkCircle;
      case "warning":
        return iconWarning;
      case "danger":
        return iconAlertCircle;
      case "neutral":
        return iconInformationCircle;
      case "info":
      default:
        return iconInformationCircle;
    }
  }
  // Oculta el banner y avisa al consumidor; éste puede revertir restaurando `hidden=false`.
  dismiss() {
    this.hidden = true;
    this.dispatchEvent(new CustomEvent("ok-dismiss", { bubbles: true, composed: true }));
  }
  render() {
    const iconName = this.icon ?? this.defaultIcon();
    return b2`
      <div class="box" role="status">
        <ion-icon class="icon" .icon=${okIcon(iconName)} aria-hidden="true"></ion-icon>
        <div class="content">
          <div class="row">
            <div class="text">
              ${this.heading ? b2`<div class="heading">${this.heading}</div>` : null}
              <div class="body"><slot></slot></div>
            </div>
            <div class="actions ${this.hasActions ? "" : "empty"}">
              <slot name="actions" @slotchange=${this.onActionsSlotChange}></slot>
            </div>
          </div>
        </div>
        ${this.dismissible ? b2`
              <button class="close" aria-label=${this.t.dismiss} @click=${this.dismiss}>
                <ion-icon .icon=${iconClose} aria-hidden="true"></ion-icon>
              </button>
            ` : null}
      </div>
    `;
  }
};
__decorateClass2([
  n4({ type: String, reflect: true })
], OkInlineFeedback.prototype, "tone");
__decorateClass2([
  n4({ type: String })
], OkInlineFeedback.prototype, "heading");
__decorateClass2([
  n4({ type: String })
], OkInlineFeedback.prototype, "icon");
__decorateClass2([
  n4({ type: Boolean, reflect: true })
], OkInlineFeedback.prototype, "dismissible");
__decorateClass2([
  n4({ type: Boolean, reflect: true })
], OkInlineFeedback.prototype, "hidden");
__decorateClass2([
  n4({ attribute: false })
], OkInlineFeedback.prototype, "labels");
__decorateClass2([
  r5()
], OkInlineFeedback.prototype, "hasActions");
define("ok-inline-feedback", OkInlineFeedback);

// @erplora/outfitkit/dist/ok-timeline.js
var __defProp3 = Object.defineProperty;
var __decorateClass3 = (decorators, target, key, kind) => {
  var result = void 0;
  for (var i7 = decorators.length - 1, decorator; i7 >= 0; i7--)
    if (decorator = decorators[i7])
      result = decorator(target, key, result) || result;
  if (result) __defProp3(target, key, result);
  return result;
};
var OkTimeline = class extends i3 {
  constructor() {
    super(...arguments);
    this.items = [];
    this.align = "left";
  }
  static {
    this.styles = i`
    :host {
      /* Vars overridable (estilo Ionic), default = cadena --ok-* -> --ion-* -> hex */
      --color: var(--ok-text, var(--ion-text-color, #1c1b17));
      --color-muted: var(--ok-text-muted, rgba(var(--ion-text-color-rgb, 28, 27, 23), 0.55));
      --primary-color: var(--ok-primary, var(--ion-color-primary, #3880ff));
      --primary-contrast: var(--ok-primary-contrast, var(--ion-color-primary-contrast, #ffffff));
      --done-color: var(--ok-success, var(--ion-color-success, #2dd36f));
      --pending-color: var(--ok-medium, var(--ion-color-medium, #92949c));
      --line-color: var(--ok-border-soft, rgba(var(--ion-text-color-rgb, 28, 27, 23), 0.14));
      --hover-bg: var(--ok-hover, rgba(var(--ion-text-color-rgb, 28, 27, 23), 0.06));
      --current-bg: var(
        --ok-current-bg,
        rgba(var(--ion-color-primary-rgb, 56, 128, 255), 0.1)
      );
      --border-radius: var(--ok-radius, 8px);
      --dot-size: var(--ok-timeline-dot, 28px);
      --gutter: var(--ok-timeline-gutter, 14px);
      --font: var(--ok-font, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);

      /* Por defecto ocupa el ancho del contenedor y es responsive. */
      display: block;
      width: 100%;
      color: var(--color);
      font-family: var(--font);
      font-size: 0.95rem;
    }

    .timeline {
      position: relative;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    /* Item: rejilla [punto | contenido]. La línea vertical se dibuja en la columna del punto. */
    .item {
      position: relative;
      display: grid;
      grid-template-columns: var(--dot-size) 1fr;
      column-gap: var(--gutter);
      padding: 0.15rem 0 0.9rem;
    }
    .item:last-child {
      padding-bottom: 0;
    }

    /* Columna del punto: contiene el dot y el segmento de línea que baja al siguiente. */
    .marker {
      position: relative;
      display: flex;
      justify-content: center;
    }
    /* Segmento de línea: arranca bajo el dot y llega al final del item. */
    .marker::before {
      content: '';
      position: absolute;
      top: var(--dot-size);
      bottom: calc(-0.9rem);
      left: 50%;
      width: 2px;
      transform: translateX(-50%);
      background: var(--line-color);
    }
    .item:last-child .marker::before {
      display: none;
    }

    .dot {
      position: relative;
      z-index: 1;
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--dot-size);
      height: var(--dot-size);
      border-radius: 50%;
      background: var(--dot-color, var(--pending-color));
      color: var(--dot-contrast, #ffffff);
      box-shadow: 0 0 0 3px var(--ok-surface, var(--ion-background-color, #ffffff));
    }
    .dot ion-icon {
      font-size: calc(var(--dot-size) * 0.5);
    }

    /* Contenido del hito; es un botón accesible para emitir el click. */
    .content {
      min-width: 0;
      text-align: left;
      width: 100%;
      margin: 0;
      padding: 0.35rem 0.55rem;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
      border-radius: var(--border-radius);
      transition: background-color var(--ok-transition, 150ms ease),
        color var(--ok-transition, 150ms ease), border-color var(--ok-transition, 150ms ease),
        box-shadow var(--ok-transition, 150ms ease), transform 120ms ease;
    }
    @media (hover: hover) {
      .content:hover {
        background: var(--hover-bg);
      }
    }
    .content:active {
      transform: scale(var(--ok-press-scale, 0.97));
    }
    @media (prefers-reduced-motion: reduce) {
      .content:active {
        transform: none;
      }
    }
    .item.current .content {
      background: var(--current-bg);
    }

    .head {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .title {
      font-weight: 600;
      min-width: 0;
    }
    .item.current .title {
      color: var(--primary-color);
    }
    .time {
      font-size: 0.8rem;
      color: var(--color-muted);
      white-space: nowrap;
    }
    .desc {
      margin-top: 0.2rem;
      color: var(--color-muted);
      font-size: 0.88rem;
      line-height: 1.35;
    }

    /* Modo alternado (solo en pantallas anchas): los items pares van a la derecha. */
    @media (min-width: 640px) {
      .timeline.alternate .item {
        grid-template-columns: 1fr var(--dot-size) 1fr;
      }
      .timeline.alternate .marker {
        grid-column: 2;
        order: 0;
      }
      .timeline.alternate .item .content {
        grid-column: 3;
      }
      .timeline.alternate .item.alt .content {
        grid-column: 1;
        text-align: right;
      }
      .timeline.alternate .item.alt .head {
        justify-content: flex-end;
      }
    }
  `;
  }
  // Resuelve el color del punto: explícito en el item, o derivado del status.
  dotColor(item) {
    if (item.color) {
      return /^[a-z-]+$/.test(item.color) ? `var(--ion-color-${item.color}, ${item.color})` : item.color;
    }
    switch (item.status) {
      case "done":
        return "var(--done-color)";
      case "current":
        return "var(--primary-color)";
      default:
        return "var(--pending-color)";
    }
  }
  // Emite `ok-item-click` con el item pulsado.
  emitClick(item) {
    this.dispatchEvent(
      new CustomEvent("ok-item-click", {
        detail: { id: item.id, item },
        bubbles: true,
        composed: true
      })
    );
  }
  renderItem(item, index) {
    const isCurrent = item.status === "current";
    const isAlt = this.align === "alternate" && index % 2 === 1;
    const classes = ["item", isCurrent ? "current" : "", isAlt ? "alt" : ""].filter(Boolean).join(" ");
    const dotStyle = `--dot-color: ${this.dotColor(item)}`;
    return b2`<li class=${classes}>
      <span class="marker">
        <span class="dot" style=${dotStyle}>
          ${item.icon ? b2`<ion-icon .icon=${okIcon(item.icon)}></ion-icon>` : ""}
        </span>
      </span>
      <button
        type="button"
        class="content"
        @click=${() => this.emitClick(item)}
      >
        <span class="head">
          <span class="title">${item.title}</span>
          ${item.time ? b2`<span class="time">${item.time}</span>` : ""}
        </span>
        ${item.description ? b2`<div class="desc">${item.description}</div>` : ""}
      </button>
    </li>`;
  }
  render() {
    const listClass = `timeline ${this.align === "alternate" ? "alternate" : ""}`.trim();
    return b2`<ul class=${listClass}>
      ${this.items.map((item, i7) => this.renderItem(item, i7))}
    </ul>`;
  }
};
__decorateClass3([
  n4({ attribute: false })
], OkTimeline.prototype, "items");
__decorateClass3([
  n4()
], OkTimeline.prototype, "align");
define("ok-timeline", OkTimeline);

// locales/es.json
var es_default = {
  name: "Citas",
  description: "Agenda las citas de tus clientes con sus servicios y profesionales, y s\xEDguelas desde que se reservan hasta que se completan.",
  navigation: {
    appointments: {
      label: "Citas"
    }
  },
  settings: {
    title: "Citas",
    fields: {
      default_duration: {
        label: "Duraci\xF3n por defecto (minutos)"
      },
      min_booking_notice: {
        label: "Antelaci\xF3n m\xEDnima para reservar (minutos)"
      },
      max_advance_booking: {
        label: "Reservar como m\xE1ximo con esta antelaci\xF3n (d\xEDas)"
      },
      allow_overlapping: {
        label: "Permitir citas solapadas"
      },
      send_reminders: {
        label: "Enviar recordatorios"
      },
      reminder_hours_before: {
        label: "Enviar el recordatorio con estas horas de antelaci\xF3n"
      },
      allow_customer_cancellation: {
        label: "Permitir que el cliente cancele su cita"
      },
      cancellation_notice_hours: {
        label: "Antelaci\xF3n m\xEDnima para cancelar (horas)"
      },
      calendar_start_hour: {
        label: "El calendario empieza a las (hora)"
      },
      calendar_end_hour: {
        label: "El calendario termina a las (hora)"
      },
      slot_interval: {
        label: "Intervalo entre huecos (minutos)"
      },
      hold_minutes: {
        label: "Apartar el hueco durante (minutos)",
        description: "Minutos que un hueco queda apartado mientras alguien decide sobre una solicitud de cita pendiente. 0 desactiva la reserva temporal."
      },
      auto_confirm_online: {
        label: "Confirmar autom\xE1ticamente las citas que reserva el cliente",
        description: "Cuando est\xE1 activado, una cita que reserva el propio cliente \u2014por internet o por una automatizaci\xF3n como WhatsApp\u2014 se crea ya confirmada y nadie tiene que aceptarlas una a una. Desact\xEDvalo para revisarlas todas antes de darlas por buenas."
      }
    }
  },
  ui: {
    title: "Citas",
    allStatuses: "Todos los estados",
    statusAll: "Todos",
    statusPending: "Pendiente",
    statusConfirmed: "Confirmada",
    statusInProgress: "En curso",
    statusCompleted: "Completada",
    statusCancelled: "Cancelada",
    statusNoShow: "No-show",
    colTime: "Hora",
    colNumber: "N\xBA",
    colCustomer: "Cliente",
    colService: "Servicio",
    colStaff: "Personal",
    colStatus: "Estado",
    actionCharge: "Cobrar",
    actionConfirm: "Confirmar",
    actionStart: "Iniciar",
    actionComplete: "Completar",
    actionCancel: "Cancelar",
    actionDelete: "Borrar",
    fieldDate: "D\xEDa",
    fieldCustomer: "Cliente",
    fieldService: "Servicio",
    fieldStart: "Inicio",
    fieldMinutes: "Min.",
    saving: "Guardando\u2026",
    addAppointment: "A\xF1adir cita",
    searchPlaceholder: "Buscar n\xBA, cliente o servicio\u2026",
    loading: "Cargando\u2026",
    empty: "Sin citas para este d\xEDa.",
    errLoad: "Error cargando citas",
    errCreate: "No se pudo crear la cita",
    pastStartNotice: "Esta cita empieza en el pasado. Se guardar\xE1 como ya iniciada.",
    errAction: "No se pudo ejecutar la acci\xF3n",
    actionNoShow: "No-show",
    fieldStaff: "Profesional",
    pickCustomer: "Elige un cliente",
    pickService: "Elige un servicio",
    pickStaff: "Elige un profesional",
    viewList: "Lista",
    viewStaff: "Por profesional",
    unassigned: "Sin asignar",
    prevDay: "D\xEDa anterior",
    nextDay: "D\xEDa siguiente",
    noStaff: "A\xFAn no hay profesionales reservables.",
    errLoadCatalogs: "Error cargando clientes, servicios o personal",
    historyTitle: "Historial de visitas",
    historyEmpty: "Este cliente a\xFAn no tiene citas.",
    historyError: "No se pudo cargar el historial de visitas.",
    actionReschedule: "Reprogramar",
    rescheduleTitle: "Mover la cita",
    rescheduleHint: "Elige el nuevo hueco. La clienta, el servicio y el profesional se quedan como est\xE1n.",
    confirmReschedule: "Mover la cita",
    cancelReschedule: "Cancelar",
    errReschedule: "No se ha podido mover la cita.",
    errDragStaffChange: "Cambiar de profesional arrastrando a\xFAn no se puede: la cita se queda con su profesional. Mueve la hora o usa el panel.",
    errDragNotMovable: "Esta cita ya no se puede mover (su estado es final).",
    bookingCustomer: "Cliente",
    bookingCustomerSearch: "Busca por tel\xE9fono o nombre\u2026",
    bookingCreateCustomer: "Crear este cliente",
    bookingChange: "Cambiar",
    bookingService: "Servicio",
    bookingStaff: "Profesional",
    bookingDay: "D\xEDa",
    bookingSlot: "Hora",
    bookingPick: "Elige\u2026",
    bookingNoSlots: "No hay hueco libre ese d\xEDa. Prueba otro d\xEDa u otro profesional.",
    bookingDayClosed: "El negocio est\xE1 cerrado ese d\xEDa. Elige otra fecha.",
    openingUnknown: "No se ha podido comprobar el horario de apertura, as\xED que puede que alguna de estas horas se rechace.",
    bookingConfirm: "Aprobar y reservar",
    bookingCancel: "Cancelar",
    errLoadSlots: "No se han podido leer los huecos libres",
    errCreateCustomer: "No se ha podido crear el cliente",
    holdCountdown: "Hueco apartado para ti \xB7 {mins}:{secs}",
    holdExpired: "Se acab\xF3 el tiempo que ten\xEDamos apartado ese hueco y ha vuelto a la venta. Elige la hora otra vez.",
    holdFailed: "No se ha podido apartar ese hueco; alguien puede reservarlo mientras decides.",
    deviceZoneNotice: "Este dispositivo est\xE1 en otra zona horaria. La agenda siempre muestra el reloj del negocio:",
    seriesScopeTitle: "Editar cita peri\xF3dica",
    seriesScopeMessage: "Esta cita forma parte de una serie peri\xF3dica.",
    seriesScopeThisOnly: "Solo esta cita",
    seriesScopeFollowing: "Esta y todas las siguientes",
    seriesScopeConfirm: "Guardar cambios",
    seriesScopeMoved: "Las citas de esta serie que se modificaron por separado volver\xE1n al horario de la serie. Las citas anteriores a hoy nunca se modifican.",
    seriesScopeCancelledKept: "Las citas que anulaste a mano siguen anuladas.",
    overlapTitle: "Cita solapada",
    overlapMessage: "Este hueco se solapa con: {conflicts}. \xBFLa reservas igual?",
    overlapConfirm: "Reservar igual",
    overlapCancel: "Elegir otra hora",
    errOverlapCheck: "No se pudo comprobar si el hueco se solapa, as\xED que la cita se guard\xF3 sin ese aviso.",
    filterStatus: "Filtrar por estado",
    viewSeries: "Peri\xF3dicas",
    seriesEmpty: "Todav\xEDa no hay citas peri\xF3dicas.",
    seriesSearchPlaceholder: "Buscar por clienta, servicio o profesional",
    seriesEditTitle: "Editar cita peri\xF3dica",
    seriesSave: "Guardar de esta cita en adelante",
    seriesNoEnd: "Sin fin",
    seriesNotFound: "Esa cita peri\xF3dica ya no est\xE1 en este negocio.",
    seriesLoadError: "No se han podido cargar las citas peri\xF3dicas.",
    seriesSaveError: "No se ha podido guardar la cita peri\xF3dica.",
    seriesMaterializeError: "No se han podido reservar las citas de esta serie.",
    seriesDeleteError: "No se ha podido borrar la cita peri\xF3dica.",
    seriesActive: "Activa",
    seriesToggleActiveError: "No se ha podido cambiar el estado de la cita peri\xF3dica.",
    seriesMaterialized: "Citas reservadas para esta serie.",
    seriesSplitFrom: "Esta serie contin\xFAa a otra anterior ({id}): se parti\xF3 cuando alguien la edit\xF3 de una cita en adelante.",
    seriesBookedCount: "{booked} citas reservadas \xB7 el cambio se aplica desde el {from} ({upcoming} por delante)",
    seriesLockedInvoiced: "{invoiced} de las citas por delante ya est\xE1n cobradas y no se van a tocar.",
    seriesScopeHint: "El cambio se aplica a esta cita ({from}) y a todas las siguientes. Lo ya pasado se queda tal cual.",
    seriesUpdateOutcome: "{moved} citas movidas \xB7 {cancelled} canceladas porque ya no caben en la pauta \xB7 {locked} intactas porque ya est\xE1n cobradas",
    colPattern: "Repetici\xF3n",
    colStarts: "Empieza",
    colEnds: "Termina",
    actionEditSeries: "Editar serie",
    actionMaterialize: "Reservar citas",
    fieldFrequency: "Repetici\xF3n",
    fieldWeekday: "D\xEDa de la semana",
    fieldTime: "Hora",
    weekdayAny: "Cualquier d\xEDa",
    freqDaily: "Cada d\xEDa",
    freqWeekly: "Cada semana",
    freqBiweekly: "Cada dos semanas",
    freqMonthly: "Cada mes",
    dayMonday: "Lunes",
    dayTuesday: "Martes",
    dayWednesday: "Mi\xE9rcoles",
    dayThursday: "Jueves",
    dayFriday: "Viernes",
    daySaturday: "S\xE1bado",
    daySunday: "Domingo",
    reasonSeriesPatternChanged: "La cita peri\xF3dica cambi\xF3 de pauta"
  },
  errors: {
    "appointments.cannot_cancel": "Esta cita ya no se puede cancelar en su estado actual.",
    "appointments.cancellation_notice_required": "Esta cita solo se puede cancelar online con la antelaci\xF3n requerida. Contacta con el negocio.",
    "appointments.customer_cancellation_disabled": "La cancelaci\xF3n online no est\xE1 disponible. Contacta con el negocio.",
    "appointments.customer_mismatch": "Esta cita es de otro cliente, as\xED que no se puede gestionar en su nombre.",
    "appointments.catalog_unavailable": "No se pudo leer el cat\xE1logo de clientes, servicios o profesionales; la cita no se ha reservado.",
    "appointments.customer_not_found": "Ese cliente no existe en este negocio.",
    "appointments.invalid_start": "Esa fecha y hora de inicio no es v\xE1lida, o ya ha pasado.",
    "appointments.service_not_found": "Ese servicio no existe en este negocio.",
    "appointments.service_not_bookable": "Ese servicio no se puede reservar: est\xE1 inactivo o no es reservable.",
    "appointments.staff_not_found": "Ese profesional no existe en este negocio.",
    "appointments.staff_not_bookable": "Ese profesional no puede recibir citas: est\xE1 inactivo o no es reservable.",
    "appointments.staff_not_eligible": "Ese profesional no realiza este servicio.",
    "appointments.settings_unavailable": "No se pudieron leer los ajustes de reserva; no se ha reservado nada.",
    "appointments.availability_unavailable": "No se pudieron leer los bloqueos de la agenda; no se ha reservado nada.",
    "appointments.blocked": "Esa franja est\xE1 bloqueada en la agenda.",
    "appointments.too_soon": "Esta cita hay que reservarla con m\xE1s antelaci\xF3n.",
    "appointments.too_far": "Esta cita no se puede reservar con tanta antelaci\xF3n.",
    "appointments.recurring_unavailable": "No se pudo leer la cita recurrente; no se ha reservado nada.",
    "appointments.recurring_not_found": "Esa cita recurrente no existe en este negocio.",
    "appointments.recurring_inactive": "Esa cita recurrente est\xE1 desactivada; act\xEDvala para reservar sus ocurrencias.",
    "appointments.recurring_mismatch": "La cita recurrente no coincide con el cliente, el servicio o el profesional enviados; no se ha reservado nada.",
    "appointments.cannot_reschedule": "Esta cita ya no se puede mover en su estado actual.",
    "appointments.request_not_bound": "La petici\xF3n se aprob\xF3 sin elegir cliente, servicio, profesional y hora, as\xED que no hab\xEDa nada que reservar. \xC1brela otra vez, el\xEDgelos y apru\xE9bala.",
    "appointments.outside_schedule": "Esa hora est\xE1 fuera del horario de apertura del negocio.",
    "appointments.overlapping_appointment": "Ese profesional ya tiene una cita en esa franja. Elige otra hora u otro profesional.",
    "appointments.booking_refused": "No se ha podido reservar la cita a partir de esa petici\xF3n.",
    "appointments.slot_on_hold": "Esa franja est\xE1 apartada para una petici\xF3n pendiente. Se libera sola en unos minutos, o elige otra hora.",
    "appointments.invalid_local_time": "Esa hora no existe en el reloj del negocio: el cambio de hora la salta. Elige otra.",
    "appointments.series_locked": "Algunas citas de esta serie no se han podido cambiar: ya est\xE1n facturadas.",
    "appointments.cannot_complete": "Esta cita no se puede completar: no se ha iniciado.",
    "appointments.cannot_confirm": "Esta cita ya no se puede confirmar: ya no est\xE1 pendiente.",
    "appointments.cannot_mark_no_show": "Esta cita no se puede marcar como no presentada en su estado actual.",
    "appointments.cannot_start": "Esta cita no se puede iniciar: no est\xE1 confirmada.",
    "appointments.cannot_update_settings": "No se han podido cambiar los ajustes de reserva: este negocio no tiene ajustes en uso ahora mismo.",
    "appointments.schedule_unavailable": "Ese horario no est\xE1 disponible: no existe en este negocio o se ha eliminado."
  }
};

// locales/en.json
var en_default = {
  name: "Appointments",
  navigation: {
    appointments: {
      label: "Appointments"
    }
  },
  settings: {
    title: "Appointments",
    fields: {
      default_duration: {
        label: "Default duration (minutes)"
      },
      min_booking_notice: {
        label: "Minimum booking notice (minutes)"
      },
      max_advance_booking: {
        label: "Book at most this far ahead (days)"
      },
      allow_overlapping: {
        label: "Allow overlapping appointments"
      },
      send_reminders: {
        label: "Send reminders"
      },
      reminder_hours_before: {
        label: "Send the reminder this many hours before"
      },
      allow_customer_cancellation: {
        label: "Let customers cancel their appointment"
      },
      cancellation_notice_hours: {
        label: "Minimum cancellation notice (hours)"
      },
      calendar_start_hour: {
        label: "Calendar starts at (hour)"
      },
      calendar_end_hour: {
        label: "Calendar ends at (hour)"
      },
      slot_interval: {
        label: "Slot interval (minutes)"
      },
      hold_minutes: {
        label: "Hold a slot for (minutes)",
        description: "Minutes a slot stays set aside while somebody decides on a pending booking request. 0 switches holds off."
      },
      auto_confirm_online: {
        label: "Confirm bookings made by the customer automatically",
        description: "When on, an appointment the customer booked herself \u2014 online or through an automation such as WhatsApp \u2014 is created already confirmed, so nobody has to accept it one by one. Turn it off to review every one of them before it counts."
      }
    }
  },
  ui: {
    title: "Appointments",
    allStatuses: "All statuses",
    statusAll: "All",
    statusPending: "Pending",
    statusConfirmed: "Confirmed",
    statusInProgress: "In progress",
    statusCompleted: "Completed",
    statusCancelled: "Cancelled",
    statusNoShow: "No-show",
    colTime: "Time",
    colNumber: "No.",
    colCustomer: "Customer",
    colService: "Service",
    colStaff: "Staff",
    colStatus: "Status",
    actionCharge: "Charge",
    actionConfirm: "Confirm",
    actionStart: "Start",
    actionComplete: "Complete",
    actionCancel: "Cancel",
    actionDelete: "Delete",
    fieldDate: "Day",
    fieldCustomer: "Customer",
    fieldService: "Service",
    fieldStart: "Start",
    fieldMinutes: "Min.",
    saving: "Saving\u2026",
    addAppointment: "Add appointment",
    searchPlaceholder: "Search no., customer or service\u2026",
    loading: "Loading\u2026",
    empty: "No appointments for this day.",
    errLoad: "Error loading appointments",
    errCreate: "Could not create the appointment",
    pastStartNotice: "This appointment starts in the past. It will be saved as already begun.",
    errAction: "Could not perform the action",
    actionNoShow: "No-show",
    fieldStaff: "Professional",
    pickCustomer: "Pick a customer",
    pickService: "Pick a service",
    pickStaff: "Pick a professional",
    viewList: "List",
    viewStaff: "By professional",
    unassigned: "Unassigned",
    prevDay: "Previous day",
    nextDay: "Next day",
    noStaff: "No bookable professionals yet.",
    errLoadCatalogs: "Error loading customers, services or staff",
    historyTitle: "Visit history",
    historyEmpty: "No appointments yet for this customer.",
    historyError: "The visit history could not be loaded.",
    actionReschedule: "Reschedule",
    rescheduleTitle: "Move appointment",
    rescheduleHint: "Pick the new slot. The customer, the service and the professional stay as they are.",
    confirmReschedule: "Move appointment",
    cancelReschedule: "Cancel",
    errReschedule: "The appointment could not be moved.",
    errDragStaffChange: "Changing professional by dragging is not available yet - the appointment stays with its professional. Use the time change or the panel.",
    errDragNotMovable: "This appointment can no longer be moved (its state is final).",
    bookingCustomer: "Customer",
    bookingCustomerSearch: "Search by phone or name\u2026",
    bookingCreateCustomer: "Create this customer",
    bookingChange: "Change",
    bookingService: "Service",
    bookingStaff: "Professional",
    bookingDay: "Day",
    bookingSlot: "Time",
    bookingPick: "Choose\u2026",
    bookingNoSlots: "No free time that day. Try another day or another professional.",
    bookingDayClosed: "The business is closed that day. Pick another date.",
    openingUnknown: "The opening hours could not be checked, so some of these times may be turned down.",
    bookingConfirm: "Approve and book",
    bookingCancel: "Cancel",
    errLoadSlots: "Could not read the free slots",
    errCreateCustomer: "Could not create the customer",
    holdCountdown: "Slot held for you \xB7 {mins}:{secs}",
    holdExpired: "The hold on that slot lapsed, so it is back on sale. Pick a time again.",
    holdFailed: "That slot could not be set aside; someone else may book it while you decide.",
    deviceZoneNotice: "This device is on a different time zone. The agenda always shows the business clock:",
    seriesScopeTitle: "Edit repeating appointment",
    seriesScopeMessage: "This appointment is part of a repeating series.",
    seriesScopeThisOnly: "This appointment only",
    seriesScopeFollowing: "This and all following appointments",
    seriesScopeConfirm: "Save changes",
    seriesScopeMoved: "Appointments in this series that were edited separately will go back to the series schedule. Appointments before today are never changed.",
    seriesScopeCancelledKept: "Appointments you cancelled by hand stay cancelled.",
    overlapTitle: "Overlapping appointment",
    overlapMessage: "This slot overlaps with: {conflicts}. Book it anyway?",
    overlapConfirm: "Book anyway",
    overlapCancel: "Pick another time",
    errOverlapCheck: "The agenda could not be checked for overlaps, so the appointment was saved without that warning.",
    filterStatus: "Filter by status",
    viewSeries: "Repeating",
    seriesEmpty: "No repeating appointments yet.",
    seriesSearchPlaceholder: "Search by customer, service or professional",
    seriesEditTitle: "Edit repeating appointment",
    seriesSave: "Save from this occurrence on",
    seriesNoEnd: "No end",
    seriesNotFound: "That repeating appointment is no longer in this business.",
    seriesLoadError: "Repeating appointments could not be loaded.",
    seriesSaveError: "The repeating appointment could not be saved.",
    seriesMaterializeError: "The appointments of this series could not be booked.",
    seriesDeleteError: "The repeating appointment could not be deleted.",
    seriesActive: "Active",
    seriesToggleActiveError: "The repeating appointment's status could not be changed.",
    seriesMaterialized: "Appointments booked for this series.",
    seriesSplitFrom: "This series continues an earlier one ({id}): it was split when someone edited it from one occurrence onwards.",
    seriesBookedCount: "{booked} appointments booked \xB7 the change applies from {from} ({upcoming} upcoming)",
    seriesLockedInvoiced: "{invoiced} of the upcoming appointments are already charged and will not be touched.",
    seriesScopeHint: "The change applies to this occurrence ({from}) and all the following ones. What is already past stays exactly as it is.",
    seriesUpdateOutcome: "{moved} appointments moved \xB7 {cancelled} cancelled because they no longer fit the pattern \xB7 {locked} left alone because they are already charged",
    colPattern: "Repeats",
    colStarts: "Starts",
    colEnds: "Ends",
    actionEditSeries: "Edit series",
    actionMaterialize: "Book appointments",
    fieldFrequency: "Repeats",
    fieldWeekday: "Day of the week",
    fieldTime: "Time",
    weekdayAny: "Any day",
    freqDaily: "Every day",
    freqWeekly: "Every week",
    freqBiweekly: "Every two weeks",
    freqMonthly: "Every month",
    dayMonday: "Monday",
    dayTuesday: "Tuesday",
    dayWednesday: "Wednesday",
    dayThursday: "Thursday",
    dayFriday: "Friday",
    daySaturday: "Saturday",
    daySunday: "Sunday",
    reasonSeriesPatternChanged: "The repeating appointment changed its pattern"
  },
  errors: {
    "appointments.cannot_cancel": "This appointment can no longer be cancelled in its current state.",
    "appointments.cancellation_notice_required": "This appointment can only be cancelled online with the required advance notice. Please contact the business.",
    "appointments.customer_cancellation_disabled": "Online cancellation is not available. Please contact the business.",
    "appointments.customer_mismatch": "This appointment belongs to a different customer, so it cannot be managed on their behalf.",
    "appointments.catalog_unavailable": "The customer, service or staff catalogue could not be read; the appointment was not booked.",
    "appointments.customer_not_found": "That customer does not exist in this business.",
    "appointments.invalid_start": "That start date and time is not valid, or it is already in the past.",
    "appointments.service_not_found": "That service does not exist in this business.",
    "appointments.service_not_bookable": "That service cannot be booked: it is inactive or not bookable.",
    "appointments.staff_not_found": "That professional does not exist in this business.",
    "appointments.staff_not_bookable": "That professional cannot take appointments: inactive or not bookable.",
    "appointments.staff_not_eligible": "That professional does not perform this service.",
    "appointments.settings_unavailable": "The booking settings could not be read; nothing was booked.",
    "appointments.availability_unavailable": "The agenda's blocked periods could not be read; nothing was booked.",
    "appointments.blocked": "That slot is blocked in the agenda.",
    "appointments.too_soon": "This appointment must be booked further in advance.",
    "appointments.too_far": "This appointment cannot be booked that far in advance.",
    "appointments.recurring_unavailable": "The recurring appointment could not be read; nothing was booked.",
    "appointments.recurring_not_found": "That recurring appointment does not exist in this business.",
    "appointments.recurring_inactive": "That recurring appointment is switched off; reactivate it to book its occurrences.",
    "appointments.recurring_mismatch": "The recurring appointment does not match the customer, service or professional sent; nothing was booked.",
    "appointments.cannot_reschedule": "This appointment can no longer be moved in its current state.",
    "appointments.request_not_bound": "The request was approved without choosing a customer, a service, a professional and a time, so there was nothing to book. Open it again, pick them, and approve.",
    "appointments.outside_schedule": "That time is outside the business opening hours.",
    "appointments.overlapping_appointment": "That professional already has an appointment in that slot. Pick another time or another professional.",
    "appointments.booking_refused": "The appointment could not be booked from that request.",
    "appointments.slot_on_hold": "That slot is being held for a pending request. It frees itself in a few minutes, or pick another time.",
    "appointments.invalid_local_time": "That time does not exist on the business clock: the daylight saving change skips it. Pick another one.",
    "appointments.series_locked": "Some appointments of this series could not be changed: they are already invoiced.",
    "appointments.cannot_complete": "This appointment cannot be completed: it has not been started.",
    "appointments.cannot_confirm": "This appointment can no longer be confirmed: it is not pending any more.",
    "appointments.cannot_mark_no_show": "This appointment cannot be marked as a no-show in its current state.",
    "appointments.cannot_start": "This appointment cannot be started: it is not confirmed.",
    "appointments.cannot_update_settings": "The booking settings could not be changed: this business has no settings in use right now.",
    "appointments.schedule_unavailable": "That schedule is not available: it does not exist in this business or it has been deleted."
  }
};

// ui/lib/business-time.ts
var InvalidLocalTimeError = class extends Error {
  constructor(wall, timezone) {
    super(`invalid_local_time: ${wall} does not exist in ${timezone}`);
    this.wall = wall;
    this.timezone = timezone;
    this.code = "appointments.invalid_local_time";
    this.name = "InvalidLocalTimeError";
  }
};
var DAY_MS = 864e5;
var WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
var formatters = /* @__PURE__ */ new Map();
function partsFormatter(timezone) {
  let f3 = formatters.get(timezone);
  if (!f3) {
    f3 = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    formatters.set(timezone, f3);
  }
  return f3;
}
function partsAt(instantMs, timezone) {
  const got = {};
  for (const p4 of partsFormatter(timezone).formatToParts(new Date(instantMs))) {
    if (p4.type !== "literal") got[p4.type] = p4.value;
  }
  return {
    y: Number(got.year),
    mo: Number(got.month),
    d: Number(got.day),
    h: Number(got.hour),
    mi: Number(got.minute),
    s: Number(got.second)
  };
}
var asUtcMs = (p4) => Date.UTC(p4.y, p4.mo - 1, p4.d, p4.h, p4.mi, p4.s);
function offsetMinutesAt(instantMs, timezone) {
  return Math.round((asUtcMs(partsAt(instantMs, timezone)) - instantMs) / 6e4);
}
var pad = (n6) => String(n6).padStart(2, "0");
function candidateInstants(wall, timezone) {
  const wallMs = asUtcMs(wall);
  const offsets = /* @__PURE__ */ new Set([
    offsetMinutesAt(wallMs - DAY_MS, timezone),
    offsetMinutesAt(wallMs + DAY_MS, timezone)
  ]);
  const matches = [];
  for (const off of offsets) {
    const candidate = wallMs - off * 6e4;
    if (asUtcMs(partsAt(candidate, timezone)) === wallMs) matches.push(candidate);
  }
  return [...new Set(matches)].sort((a3, b3) => a3 - b3);
}
function parseWall(wall) {
  const m4 = WALL_TIME.exec(wall.trim());
  if (!m4) return null;
  const p4 = {
    y: Number(m4[1]),
    mo: Number(m4[2]),
    d: Number(m4[3]),
    h: Number(m4[4]),
    mi: Number(m4[5]),
    s: m4[6] ? Number(m4[6]) : 0
  };
  const back = new Date(asUtcMs(p4));
  const same = back.getUTCFullYear() === p4.y && back.getUTCMonth() + 1 === p4.mo && back.getUTCDate() === p4.d && back.getUTCHours() === p4.h && back.getUTCMinutes() === p4.mi;
  return same ? p4 : null;
}
function businessTimezone() {
  const tz = globalThis.erplora?.timezone;
  return typeof tz === "string" && tz.trim() ? tz.trim() : "UTC";
}
function todayISO(timezone = businessTimezone(), now = /* @__PURE__ */ new Date()) {
  const p4 = partsAt(now.getTime(), timezone);
  return `${p4.y}-${pad(p4.mo)}-${pad(p4.d)}`;
}
function addDaysISO(day, delta) {
  const m4 = /^(\d{4})-(\d{2})-(\d{2})$/.exec((day ?? "").trim());
  if (!m4) return day;
  const t5 = Date.UTC(Number(m4[1]), Number(m4[2]) - 1, Number(m4[3])) + delta * DAY_MS;
  const d3 = new Date(t5);
  return `${d3.getUTCFullYear()}-${pad(d3.getUTCMonth() + 1)}-${pad(d3.getUTCDate())}`;
}
function dayBounds(day, timezone = businessTimezone()) {
  const startOf = (isoDay) => {
    const p4 = parseWall(`${isoDay}T00:00:00`);
    if (!p4) throw new InvalidLocalTimeError(isoDay, timezone);
    const candidates = candidateInstants(p4, timezone);
    if (candidates.length > 0) return candidates[0];
    return asUtcMs(p4) - offsetMinutesAt(asUtcMs(p4) - DAY_MS, timezone) * 6e4;
  };
  const start = startOf(day);
  const next = new Date(start + 36 * 36e5);
  const nextParts = partsAt(next.getTime(), timezone);
  return {
    day_start: new Date(start).toISOString(),
    day_end: new Date(
      startOf(`${nextParts.y}-${pad(nextParts.mo)}-${pad(nextParts.d)}`)
    ).toISOString()
  };
}
function wallClock(iso, timezone = businessTimezone()) {
  const t5 = Date.parse(iso);
  if (Number.isNaN(t5)) return "00:00";
  const p4 = partsAt(t5, timezone);
  return `${pad(p4.h)}:${pad(p4.mi)}`;
}
function formatWallTime(iso, timezone = businessTimezone(), locale = "es") {
  const t5 = Date.parse(iso);
  if (Number.isNaN(t5)) return iso;
  return new Date(t5).toLocaleTimeString(locale || "es", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
}
function toInputValue(iso, timezone = businessTimezone()) {
  const t5 = Date.parse(iso);
  if (Number.isNaN(t5)) return "";
  const p4 = partsAt(t5, timezone);
  return `${p4.y}-${pad(p4.mo)}-${pad(p4.d)}T${pad(p4.h)}:${pad(p4.mi)}`;
}
function wallToInstant(wall, timezone = businessTimezone()) {
  const p4 = parseWall(wall);
  if (!p4) throw new InvalidLocalTimeError(wall, timezone);
  const candidates = candidateInstants(p4, timezone);
  if (candidates.length === 0) throw new InvalidLocalTimeError(wall, timezone);
  return new Date(candidates[0]).toISOString();
}
function wallToBusinessIso(wall, timezone = businessTimezone()) {
  const instant = Date.parse(wallToInstant(wall, timezone));
  const p4 = partsAt(instant, timezone);
  const off = offsetMinutesAt(instant, timezone);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  return `${p4.y}-${pad(p4.mo)}-${pad(p4.d)}T${pad(p4.h)}:${pad(p4.mi)}:${pad(p4.s)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
function toInstantMs(iso, timezone = businessTimezone()) {
  const text = (iso ?? "").trim();
  if (!text) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const t5 = Date.parse(text);
    return Number.isNaN(t5) ? null : t5;
  }
  try {
    return Date.parse(wallToInstant(text.slice(0, 19), timezone));
  } catch {
    return null;
  }
}
function deviceZoneDiffers(timezone = businessTimezone()) {
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (device === timezone) return false;
  const now = Date.now();
  return offsetMinutesAt(now, timezone) !== -new Date(now).getTimezoneOffset();
}

// ui/components/erp-appointments-customer-history/erp-appointments-customer-history.ts
var CATALOG = { es: es_default, en: en_default };
function erplora() {
  const c5 = globalThis.erplora;
  if (!c5) throw new Error("erplora SDK not initialised by the shell");
  return c5;
}
function rows(r6) {
  if (Array.isArray(r6)) return r6;
  if (r6 && typeof r6 === "object" && Array.isArray(r6.rows)) return r6.rows;
  return [];
}
var LAST_N = 10;
var STATUS_KEYS = {
  pending: "ui.statusPending",
  confirmed: "ui.statusConfirmed",
  in_progress: "ui.statusInProgress",
  completed: "ui.statusCompleted",
  cancelled: "ui.statusCancelled",
  no_show: "ui.statusNoShow"
};
function timelineStatus(status) {
  switch (status) {
    case "completed":
      return { status: "done", icon: "checkmark-outline" };
    case "in_progress":
      return { status: "current", icon: "play-outline" };
    case "cancelled":
    case "no_show":
      return { status: "pending", color: "danger", icon: "close-outline" };
    default:
      return { status: "pending", icon: "time-outline" };
  }
}
function formatWhen(iso, locale) {
  const d3 = new Date(iso);
  if (Number.isNaN(d3.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale || void 0, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: businessTimezone()
    }).format(d3);
  } catch {
    return iso;
  }
}
var ErpAppointmentsCustomerHistory = class extends i3 {
  constructor() {
    super(...arguments);
    this.customerId = "";
    this.visits = [];
    this.loading = false;
    this.error = "";
    /** Sequence guard: a slow answer for the previous customer must never paint over the new one. */
    this.seq = 0;
    this.onCustomerDetail = (ev) => {
      const detail = ev.detail;
      const id = String(detail?.customer_id ?? "");
      if (!id) return;
      void this.load(id);
    };
  }
  static {
    this.styles = i`
    :host { display: block; font-family: system-ui, sans-serif; color: var(--ion-text-color, #1c1b18); }
    h3 { font-size: 0.95rem; font-weight: 600; margin: 0 0 .5rem; display: flex; align-items: center; gap: .4rem; }
    .empty { color: var(--ion-color-medium, #8b897f); margin: .25rem 0 0; font-size: .9rem; }
    .loading { color: var(--ion-color-medium, #8b897f); font-size: .9rem; }
  `;
  }
  connectedCallback() {
    super.connectedCallback();
    this.addEventListener("erp:customer-detail", this.onCustomerDetail);
  }
  disconnectedCallback() {
    this.removeEventListener("erp:customer-detail", this.onCustomerDetail);
    super.disconnectedCallback();
  }
  async load(customerId) {
    const mySeq = ++this.seq;
    this.customerId = customerId;
    this.loading = true;
    this.error = "";
    try {
      const result = await erplora().query("appointments.appointments.list_for_customer_with_notes", {
        customer_id: customerId,
        limit: LAST_N
      });
      if (mySeq !== this.seq) return;
      this.visits = rows(result);
    } catch {
      if (mySeq !== this.seq) return;
      this.visits = [];
      this.error = erplora().t(CATALOG, "ui.historyError");
    } finally {
      if (mySeq === this.seq) this.loading = false;
    }
  }
  items() {
    const t5 = (k2) => erplora().t(CATALOG, k2);
    const locale = erplora().locale;
    return this.visits.map((v3) => {
      const dot = timelineStatus(v3.status);
      const who = [v3.service_name, v3.staff_name].filter(Boolean).join(" \xB7 ");
      const statusLabel = t5(STATUS_KEYS[v3.status] ?? v3.status);
      const description = [v3.internal_notes, v3.notes].map((s5) => (s5 ?? "").trim()).filter(Boolean).join(" \u2014 ");
      return {
        id: v3.id,
        title: `${who} \xB7 ${statusLabel}`,
        time: `${formatWhen(v3.start_datetime, locale)} \xB7 ${v3.appointment_number}`,
        description: description || void 0,
        status: dot.status,
        color: dot.color,
        icon: dot.icon
      };
    });
  }
  render() {
    if (!this.customerId) return A;
    const t5 = (k2) => erplora().t(CATALOG, k2);
    return b2`
      <h3>${t5("ui.historyTitle")}</h3>
      ${this.error ? b2`<ok-inline-feedback data-testid="appointments-customer-history-error" tone="danger" icon="alert-circle-outline">${this.error}</ok-inline-feedback>` : A}
      ${this.loading && !this.visits.length ? b2`<p class="loading">${t5("ui.loading")}</p>` : A}
      ${!this.loading && !this.error && !this.visits.length ? b2`<p class="empty">${t5("ui.historyEmpty")}</p>` : A}
      ${this.visits.length ? b2`<ok-timeline .items=${this.items()}></ok-timeline>` : A}
    `;
  }
};
__decorateClass([
  r5()
], ErpAppointmentsCustomerHistory.prototype, "customerId", 2);
__decorateClass([
  r5()
], ErpAppointmentsCustomerHistory.prototype, "visits", 2);
__decorateClass([
  r5()
], ErpAppointmentsCustomerHistory.prototype, "loading", 2);
__decorateClass([
  r5()
], ErpAppointmentsCustomerHistory.prototype, "error", 2);
define("erp-appointments-customer-history", ErpAppointmentsCustomerHistory);

// lit-html/directive.js
var t3 = { ATTRIBUTE: 1, CHILD: 2, PROPERTY: 3, BOOLEAN_ATTRIBUTE: 4, EVENT: 5, ELEMENT: 6 };
var e4 = (t5) => (...e5) => ({ _$litDirective$: t5, values: e5 });
var i4 = class {
  constructor(t5) {
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AT(t5, e5, i7) {
    this._$Ct = t5, this._$AM = e5, this._$Ci = i7;
  }
  _$AS(t5, e5) {
    return this.update(t5, e5);
  }
  update(t5, e5) {
    return this.render(...e5);
  }
};

// lit-html/directive-helpers.js
var { I: t4 } = j;
var i5 = (o7) => o7;
var s4 = () => document.createComment("");
var v2 = (o7, n6, e5) => {
  const l3 = o7._$AA.parentNode, d3 = void 0 === n6 ? o7._$AB : n6._$AA;
  if (void 0 === e5) {
    const i7 = l3.insertBefore(s4(), d3), n7 = l3.insertBefore(s4(), d3);
    e5 = new t4(i7, n7, o7, o7.options);
  } else {
    const t5 = e5._$AB.nextSibling, n7 = e5._$AM, c5 = n7 !== o7;
    if (c5) {
      let t6;
      e5._$AQ?.(o7), e5._$AM = o7, void 0 !== e5._$AP && (t6 = o7._$AU) !== n7._$AU && e5._$AP(t6);
    }
    if (t5 !== d3 || c5) {
      let o8 = e5._$AA;
      for (; o8 !== t5; ) {
        const t6 = i5(o8).nextSibling;
        i5(l3).insertBefore(o8, d3), o8 = t6;
      }
    }
  }
  return e5;
};
var u3 = (o7, t5, i7 = o7) => (o7._$AI(t5, i7), o7);
var m3 = {};
var p3 = (o7, t5 = m3) => o7._$AH = t5;
var M2 = (o7) => o7._$AH;
var h3 = (o7) => {
  o7._$AR(), o7._$AA.remove();
};

// lit-html/directives/repeat.js
var u4 = (e5, s5, t5) => {
  const r6 = /* @__PURE__ */ new Map();
  for (let l3 = s5; l3 <= t5; l3++) r6.set(e5[l3], l3);
  return r6;
};
var c4 = e4(class extends i4 {
  constructor(e5) {
    if (super(e5), e5.type !== t3.CHILD) throw Error("repeat() can only be used in text expressions");
  }
  dt(e5, s5, t5) {
    let r6;
    void 0 === t5 ? t5 = s5 : void 0 !== s5 && (r6 = s5);
    const l3 = [], o7 = [];
    let i7 = 0;
    for (const s6 of e5) l3[i7] = r6 ? r6(s6, i7) : i7, o7[i7] = t5(s6, i7), i7++;
    return { values: o7, keys: l3 };
  }
  render(e5, s5, t5) {
    return this.dt(e5, s5, t5).values;
  }
  update(s5, [t5, r6, c5]) {
    const d3 = M2(s5), { values: p4, keys: a3 } = this.dt(t5, r6, c5);
    if (!Array.isArray(d3)) return this.ut = a3, p4;
    const h4 = this.ut ??= [], v3 = [];
    let m4, y3, x2 = 0, j2 = d3.length - 1, k2 = 0, w2 = p4.length - 1;
    for (; x2 <= j2 && k2 <= w2; ) if (null === d3[x2]) x2++;
    else if (null === d3[j2]) j2--;
    else if (h4[x2] === a3[k2]) v3[k2] = u3(d3[x2], p4[k2]), x2++, k2++;
    else if (h4[j2] === a3[w2]) v3[w2] = u3(d3[j2], p4[w2]), j2--, w2--;
    else if (h4[x2] === a3[w2]) v3[w2] = u3(d3[x2], p4[w2]), v2(s5, v3[w2 + 1], d3[x2]), x2++, w2--;
    else if (h4[j2] === a3[k2]) v3[k2] = u3(d3[j2], p4[k2]), v2(s5, d3[x2], d3[j2]), j2--, k2++;
    else if (void 0 === m4 && (m4 = u4(a3, k2, w2), y3 = u4(h4, x2, j2)), m4.has(h4[x2])) if (m4.has(h4[j2])) {
      const e5 = y3.get(a3[k2]), t6 = void 0 !== e5 ? d3[e5] : null;
      if (null === t6) {
        const e6 = v2(s5, d3[x2]);
        u3(e6, p4[k2]), v3[k2] = e6;
      } else v3[k2] = u3(t6, p4[k2]), v2(s5, d3[x2], t6), d3[e5] = null;
      k2++;
    } else h3(d3[j2]), j2--;
    else h3(d3[x2]), x2++;
    for (; k2 <= w2; ) {
      const e5 = v2(s5, v3[w2 + 1]);
      u3(e5, p4[k2]), v3[k2++] = e5;
    }
    for (; x2 <= j2; ) {
      const e5 = d3[x2++];
      null !== e5 && h3(e5);
    }
    return this.ut = a3, p3(s5, v3), E;
  }
});

// lit-html/directives/style-map.js
var n5 = "important";
var i6 = " !" + n5;
var o6 = e4(class extends i4 {
  constructor(t5) {
    if (super(t5), t5.type !== t3.ATTRIBUTE || "style" !== t5.name || t5.strings?.length > 2) throw Error("The `styleMap` directive must be used in the `style` attribute and must be the only part in the attribute.");
  }
  render(t5) {
    return Object.keys(t5).reduce((e5, r6) => {
      const s5 = t5[r6];
      return null == s5 ? e5 : e5 + `${r6 = r6.includes("-") ? r6 : r6.replace(/(?:^(webkit|moz|ms|o)|)(?=[A-Z])/g, "-$&").toLowerCase()}:${s5};`;
    }, "");
  }
  update(e5, [r6]) {
    const { style: s5 } = e5.element;
    if (void 0 === this.ft) return this.ft = new Set(Object.keys(r6)), this.render(r6);
    for (const t5 of this.ft) null == r6[t5] && (this.ft.delete(t5), t5.includes("-") ? s5.removeProperty(t5) : s5[t5] = null);
    for (const t5 in r6) {
      const e6 = r6[t5];
      if (null != e6) {
        this.ft.add(t5);
        const r7 = "string" == typeof e6 && e6.endsWith(i6);
        t5.includes("-") || r7 ? s5.setProperty(t5, r7 ? e6.slice(0, -11) : e6, r7 ? n5 : "") : s5[t5] = e6;
      }
    }
    return E;
  }
});

// @erplora/outfitkit/dist/ok-data-table.js
var CSV_BOM = "\uFEFF";
var WINDOWS_1252_C1 = [
  8364,
  129,
  8218,
  402,
  8222,
  8230,
  8224,
  8225,
  710,
  8240,
  352,
  8249,
  338,
  141,
  381,
  143,
  144,
  8216,
  8217,
  8220,
  8221,
  8226,
  8211,
  8212,
  732,
  8482,
  353,
  8250,
  339,
  157,
  382,
  376
];
function decodeWindows1252(bytes) {
  let text = "";
  for (const byte of bytes) {
    text += String.fromCharCode(byte >= 128 && byte <= 159 ? WINDOWS_1252_C1[byte - 128] : byte);
  }
  return text;
}
function decodeCsvBuffer(buf) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    text = decodeWindows1252(new Uint8Array(buf));
  }
  return text.charCodeAt(0) === 65279 ? text.slice(1) : text;
}
var __defProp4 = Object.defineProperty;
var __decorateClass4 = (decorators, target, key, kind) => {
  var result = void 0;
  for (var i7 = decorators.length - 1, decorator; i7 >= 0; i7--)
    if (decorator = decorators[i7])
      result = decorator(target, key, result) || result;
  if (result) __defProp4(target, key, result);
  return result;
};
function decideRowActionsFit(input) {
  const { containerWidth, contentWidth, collapsed, decidedAtWidth } = input;
  if (!(containerWidth > 0)) return { collapsed, decidedAtWidth };
  if (containerWidth !== decidedAtWidth) {
    if (collapsed) return { collapsed: false, decidedAtWidth: containerWidth };
    return { collapsed: contentWidth > containerWidth, decidedAtWidth: containerWidth };
  }
  if (!collapsed && contentWidth > containerWidth) return { collapsed: true, decidedAtWidth };
  return { collapsed, decidedAtWidth };
}
var DEFAULT_LABELS2 = {
  search: "Search\u2026",
  empty: "No results",
  filters: "Filters",
  clear: "Clear",
  apply: "Apply",
  selected: "{n} selected",
  importCsv: "Import CSV",
  exportCsv: "Export CSV",
  add: "Add",
  moreActions: "More actions",
  rowsPerPage: "Rows per page",
  perPageShort: "{n} / page",
  viewList: "View as list",
  viewCards: "View as cards",
  columnsVisible: "Visible columns",
  columns: "Columns",
  actions: "Actions",
  close: "Close",
  newRecord: "New",
  form: "Form",
  filterPlaceholder: "Filter\u2026",
  from: "From",
  to: "To",
  fromOf: "{label} from",
  toOf: "{label} to",
  gte: "\u2265",
  lte: "\u2264",
  noValues: "No values",
  selectAll: "Select all",
  selectRow: "Select row",
  select: "Select",
  showing: "Showing {from}\u2013{to} of",
  recordSingular: "record",
  recordPlural: "records",
  loadMore: "Load more"
};
var ES_LABELS = {
  search: "Buscar\u2026",
  empty: "Sin resultados",
  filters: "Filtros",
  clear: "Limpiar",
  apply: "Aplicar",
  selected: "{n} seleccionados",
  importCsv: "Importar CSV",
  exportCsv: "Exportar CSV",
  add: "A\xF1adir",
  moreActions: "M\xE1s acciones",
  rowsPerPage: "Filas por p\xE1gina",
  perPageShort: "{n} / p\xE1g.",
  viewList: "Vista lista",
  viewCards: "Vista tarjetas",
  columnsVisible: "Columnas visibles",
  columns: "Columnas",
  actions: "Acciones",
  close: "Cerrar",
  newRecord: "Nuevo",
  form: "Formulario",
  filterPlaceholder: "Filtrar\u2026",
  from: "Desde",
  to: "Hasta",
  fromOf: "{label} desde",
  toOf: "{label} hasta",
  gte: "\u2265",
  lte: "\u2264",
  noValues: "Sin valores",
  selectAll: "Seleccionar todo",
  selectRow: "Seleccionar fila",
  select: "Seleccionar",
  showing: "Mostrando {from}\u2013{to} de",
  recordSingular: "registro",
  recordPlural: "registros",
  loadMore: "Cargar m\xE1s"
};
var _OkDataTable = class _OkDataTable2 extends i3 {
  constructor() {
    super(...arguments);
    this.columns = [];
    this.rows = [];
    this.searchKeys = [];
    this.rowKeyField = "id";
    this.pageSize = 10;
    this.labels = {};
    this.actions = [];
    this.addable = false;
    this.pageSizeOptions = [10, 25, 50, 100];
    this.fill = false;
    this.columnPicker = true;
    this.csv = false;
    this.csvName = "export.csv";
    this.serverSide = false;
    this.total = 0;
    this.page = 0;
    this.searchable = false;
    this.sortDir = "asc";
    this.filterValues = {};
    this.title = "";
    this.views = false;
    this.exportable = false;
    this.importable = false;
    this.columnSelector = false;
    this.rowClickable = false;
    this.selectable = false;
    this.inlineFilters = false;
    this.menuActions = [];
    this.q = "";
    this.clientPage = 0;
    this.clientPageSize = 0;
    this.mobileShown = 0;
    this.clientSort = "";
    this.clientSortDir = "asc";
    this.clientFilters = {};
    this.filterDraft = {};
    this.serverFilters = {};
    this.panel = "none";
    this.viewMode = "table";
    this.viewChosenByUser = false;
    this.isMobile = false;
    this.xOverflow = false;
    this.actionsTrackPx = 0;
    this.rowActionsCollapsed = false;
    this.fitDecidedAtWidth = -1;
    this.rowMenuOpen = false;
    this.hiddenKeys = /* @__PURE__ */ new Set();
    this.internalSelection = /* @__PURE__ */ new Set();
    this.menuOpen = false;
    this.onLocaleChanged = () => this.requestUpdate();
    this.onWindowResize = () => {
      this.measureXOverflow();
      this.measureRowActionsFit();
    };
    this.onSearch = (ev) => {
      const value = ev.target.value ?? "";
      if (this.serverSide) {
        this.q = value;
        this.emit("searchChange", value);
      } else {
        this.q = value;
        this.clientPage = 0;
        this.mobileShown = 0;
      }
    };
  }
  static {
    this.styles = i`
    :host {
      /* Vars overridable (estilo Ionic), default = cadena --ok-* → --ion-* → hex */
      --background: var(--ok-surface, var(--ion-card-background, var(--ion-background-color, #ffffff)));
      --color: var(--ok-text, var(--ion-text-color, #1c1b17));
      --color-muted: var(--ok-muted, var(--ion-color-medium, rgba(var(--ion-text-color-rgb, 24, 24, 27), 0.55)));
      --border-color: var(--ok-border, var(--ion-color-step-150, rgba(var(--ion-text-color-rgb, 24, 24, 27), 0.12)));
      --border-color-soft: var(--ok-border-soft, var(--ion-color-step-100, rgba(var(--ion-text-color-rgb, 24, 24, 27), 0.07)));
      /* Borde más marcado para los controles de la toolbar (selects/pastilla de fechas), para que se
       * distingan como controles en claro y oscuro aunque el lienzo y la superficie casi no contrasten. */
      --control-border: color-mix(in srgb, var(--color) 22%, transparent);
      /* Relieve de cabecera/pie: step-100 (definido en claro y oscuro) → contraste con el lienzo. */
      --header-background: var(--ok-surface-2, var(--ion-color-step-100, rgba(var(--ion-text-color-rgb, 24, 24, 27), 0.04)));
      --row-hover: var(--ok-row-hover, var(--ion-color-step-50, rgba(var(--ion-text-color-rgb, 24, 24, 27), 0.03)));
      --primary: var(--ok-primary, var(--ion-color-primary, #3880ff));
      --primary-contrast: var(--ok-primary-contrast, var(--ion-color-primary-contrast, #ffffff));
      --border-radius: var(--ok-radius, 16px);
      --font: var(--ok-font, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);

      display: block;
      color: var(--color);
      font-family: var(--font);
    }
    * { box-sizing: border-box; }
    .card {
      position: relative;
      display: flex;
      flex-direction: column;
      /* Flat: sin borde ni elevación (directiva 2026-06-09). */
      border: 0;
      border-radius: var(--border-radius);
      overflow: hidden;
      background: var(--background);
      box-shadow: none;
    }

    /* Panel lateral derecho (drawer) DENTRO de la tabla: filtros / alta-edición. Base (sin media):
       overlay absoluto — es lo que había hasta #75 y lo que ve un navegador sin media queries. */
    .tk-scrim { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.18); z-index: 19; }
    .drawer { position: absolute; top: 0; right: 0; height: 100%; width: 340px; max-width: 88%;
      background: var(--background); border-left: 1px solid var(--border-color);
      display: flex; flex-direction: column; z-index: 20;
      animation: tk-slide-in 0.18s ease; }
    @keyframes tk-slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
    /* #75 — El panel EMPUJA en escritorio y es HOJA COMPLETA en móvil; nunca tapa a medias.
       Medido en el hub (Servicios/Citas): a 1440 el overlay de 340px se pintaba ENCIMA de
       «Duración», «Acciones» y el selector de columnas, con el 90% de la tabla vacío a la
       izquierda; a 390 dejaba una tira de 45px de tabla (media lupa, medio «Co…») que hacía
       parecer el formulario un pop-up mal puesto. Square Dashboard reduce la tabla con un panel
       fijo; Fresha/Shopify/Odoo abren una hoja a pantalla completa en móvil.
       ≥ 834px: mientras hay panel, .card pasa a rejilla de DOS columnas (tabla | panel 360px):
       la tabla se estrecha (ya sabe hacer scroll-x, #67) y nada queda tapado. */
    @media (min-width: 834px) {
      .card.has-panel { display: grid; grid-template-columns: minmax(0, 1fr) 360px; grid-template-rows: auto minmax(0, 1fr) auto; }
      .card.has-panel > .bar { grid-column: 1; grid-row: 1; }
      .card.has-panel > .scroll, .card.has-panel > .cards-grid, .card.has-panel > .empty { grid-column: 1; grid-row: 2; min-height: 0; overflow: auto; }
      .card.has-panel > .pager { grid-column: 1; grid-row: 3; }
      .card.has-panel > .drawer { position: static; grid-column: 2; grid-row: 1 / -1; width: auto; max-width: none; height: auto; min-height: 0; animation: none; }
      .card.has-panel > .tk-scrim { display: none; }
    }
    /* < 834px: hoja a pantalla completa con su cabecera (título + Cerrar); sin tira residual.
       position:fixed dentro de ion-content se ancla al área de contenido (contain), que es justo el hueco
       bajo la cabecera de la app: el usuario conserva el título de la página. */
    @media (max-width: 833.98px) {
      .drawer { position: fixed; inset: 0; top: var(--ok-sheet-top, 0px); width: 100%; max-width: none; height: auto; border-left: 0; z-index: 1000; }
      .tk-scrim { display: none; }
    }
    .drawer .dh { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
      padding: 0.6rem 0.5rem 0.6rem 1rem; border-bottom: 1px solid var(--border-color); font-size: 1rem; }
    .drawer .db { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 1rem; display: flex; flex-direction: column; gap: 0.85rem; }
    .fblock { display: flex; flex-direction: column; gap: 0.45rem; }
    .flabel { font-size: 13px; font-weight: 500; color: var(--color); }
    .frange { display: flex; gap: 0.5rem; }
    /* Filtros cliente: multi-select con ion-select (ventana flotante de Ionic) + rango de fechas. */
    .daterange { display: flex; gap: 0.6rem; }
    .daterange ion-input { flex: 1; }
    /* Pie del drawer de filtros: Limpiar / Aplicar. */
    .df { flex: 0 0 auto; display: flex; align-items: center; justify-content: flex-end; gap: 0.4rem; padding: 0.6rem 0.85rem; border-top: 1px solid var(--border-color); }
    .df .df-clear { margin-right: auto; }

    /* Modo fill: la tabla ocupa el alto del contenedor; filas con scroll interno; pager fijo. */
    :host([fill]) { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    :host([fill]) .card { flex: 1 1 auto; min-height: 0; }
    :host([fill]) .bar, :host([fill]) .panel, :host([fill]) .pager { flex: 0 0 auto; }
    :host([fill]) .scroll, :host([fill]) .cards-grid { flex: 1 1 auto; min-height: 0; overflow: auto; }
    /* Sin filas, renderTable/renderCards devuelven SOLO el bloque .empty (sin .scroll). En modo
       fill hay que estirarlo para que ocupe el hueco entre toolbar y pager y centre su contenido
       (icono + mensaje) en vertical; si no, queda pegado arriba con el pager a media altura. */
    :host([fill]) .empty { flex: 1 1 auto; min-height: 0; }

    /* ── Topbar / cabecera (relieve) ─────────────────────────────────────────────────────── */
    .bar { display: flex; flex-direction: column; gap: 0.6rem; padding: 0.65rem 1rem; border-bottom: 1px solid var(--border-color); background: var(--header-background); }
    /* Toolbar CONSOLIDADA: TODOS los controles son hijos directos de UNA sola fila flex que
     * envuelve ELEMENTO A ELEMENTO (no por bloques): caben en una línea → una línea; los que no
     * caben bajan a la(s) línea(s) que hagan falta. El cluster derecho se empuja al borde con
     * .tk-spacer (hueco flexible) solo cuando todo cabe en una línea; al envolver, el spacer se
     * oculta y todo se apila a la izquierda.
     * ORDEN CANÓNICO (2026-06-22, izquierda→derecha): [buscador] · [filtros en línea] · ‹spacer› ·
     * [SELECTORES: columnas → filas/página] · [BOTONES: vistas → filtros(funnel) → import → export →
     * alta → ⋮ → acción primaria]. Es decir: buscador al inicio, filtros en medio, y al final los
     * selectores (columnas, luego «N por página») seguidos de los botones de acción. */
    .bar-main { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
    .bar-main > ion-button { --padding-start: 0.5rem; --padding-end: 0.5rem; margin: 0; }
    /* Spacer que absorbe el hueco libre en pantallas anchas (empuja el cluster derecho al borde).
     * Se oculta por debajo de 1024px para que, al envolver, los controles se apilen a la izquierda. */
    .tk-spacer { flex: 1 1 0; min-width: 0; align-self: stretch; }
    @media (max-width: 1024px) { .tk-spacer { display: none; } }
    /* Buscador a ancho completo (línea propia) en móvil; el resto envuelve debajo. */
    @media (max-width: 640px) { .search { flex-basis: 100%; max-width: none; } }
    .title-wrap { display: flex; align-items: baseline; gap: 0.5rem; }
    .title { font-size: 15px; font-weight: 600; line-height: 1; margin: 0; }
    .title-count { font-size: 12px; font-weight: 500; color: var(--color-muted); }

    /* Botón de herramienta cuadrado (filtros/import/export), look del Hub: 36×36, badge contador. */
    .toolbtn { position: relative; --padding-start: 0; --padding-end: 0; --border-radius: 10px; width: 36px; height: 36px; margin: 0; }
    .toolbtn .badge { position: absolute; top: -5px; right: -5px; min-width: 16px; height: 16px; padding: 0 3px; border-radius: 999px; background: var(--primary); color: var(--primary-contrast); font-size: 10px; font-weight: 700; line-height: 16px; text-align: center; pointer-events: none; }

    /* Buscador (caja con icono + limpiar), look del Hub. No crece (el spacer se queda el hueco);
     * puede encoger hasta min-width y, por debajo, envuelve. */
    .search { flex: 0 1 22rem; min-width: 12rem; max-width: 24rem; }
    ion-searchbar { --background: var(--background); --border-radius: 10px; padding: 0; min-height: 36px; }
    /* Flat: el buscador quita borde y elevación vía la clase específica de Ionic 'ion-no-border'.
     * (La regla global de Ionic para .ion-no-border no cruza el Shadow DOM, así que la
     * reimplementamos aquí dentro: --box-shadow controla la elevación; ::part(native) el borde.) */
    ion-searchbar.ion-no-border { --box-shadow: none; }
    ion-searchbar.ion-no-border::part(native) { border: none; box-shadow: none; }

    /* Toggle de vista lista/tarjetas (segmento) */
    .viewseg { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid var(--border-color); border-radius: 10px; background: var(--background); }
    .viewseg ion-button { --border-radius: 7px; }

    /* Botón primario (primaryAction) */
    .primary-btn { --background: var(--primary); --color: var(--primary-contrast); }
    /* #76 — El alta en MÓVIL: botón primario CON etiqueta y área táctil de 44px, en vez del «+»
       icónico de 36px al final de la barra. Fresha/Square/Shopify POS ponen la acción primaria
       de la lista como botón visible con texto (o FAB), nunca como icono anónimo.
       #113 — Y en ESCRITORIO igual: Odoo («New»), Business Central, Shopify («Add product»),
       WooCommerce, Lightspeed y Fresha rotulan y rellenan la acción principal de un listado; NN/g
       reserva el botón sin rótulo para lo universal (buscar, cerrar). Aquí solo cambia la ALTURA:
       36px para alinear con .toolbtn y el buscador, y los 44px táctiles vuelven abajo con el
       resto de objetivos de puntero grueso. */
    .add-btn { min-height: 36px; --border-radius: 10px; --padding-start: 0.9rem; --padding-end: 1rem; margin: 0; font-weight: 600; }
    .add-btn ion-icon { margin-inline-end: 0.35rem; }

    /* Selects de la toolbar: fondo + borde visibles (como el buscador y la pastilla de fechas) para
     * que se distingan como controles en claro y oscuro (sin fondo eran invisibles en dark). */
    .tk-cols { min-width: 6.5rem; max-width: 9rem; min-height: 38px; font-size: 13px; background: var(--background); color: var(--color); border: 1px solid var(--control-border); border-radius: 10px; --padding-start: 0.6rem; --padding-end: 0.4rem; --padding-top: 0.3rem; --padding-bottom: 0.3rem; }
    .vsep { width: 1px; align-self: stretch; background: var(--border-color); margin: 0.3rem 0.25rem; }

    /* Selector de filas/página en la toolbar (consolidado) */
    /* max-width: ion-select es display:block (sin core.css el host estira a la
     * línea entera cuando .bar-end hace wrap) — se capa como .tk-cols. */
    .tk-psize { min-width: 4.25rem; max-width: 5.5rem; min-height: 38px; font-size: 13px; background: var(--background); color: var(--color); border: 1px solid var(--control-border); border-radius: 10px; --padding-start: 0.6rem; --padding-end: 0.4rem; --padding-top: 0.35rem; --padding-bottom: 0.35rem; }

    /* Filtros EN LÍNEA en la toolbar (select / rango de fechas) */
    .tk-filter { min-width: 8.5rem; max-width: 13rem; min-height: 38px; font-size: 13px; background: var(--background); color: var(--color); border: 1px solid var(--control-border); border-radius: 10px; --padding-start: 0.7rem; --padding-end: 0.5rem; --padding-top: 0.35rem; --padding-bottom: 0.35rem; }
    .tk-daterange { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.3rem 0.6rem; min-height: 38px; border: 1px solid var(--control-border); border-radius: 10px; background: var(--background); color: var(--color-muted); font-size: 13px; }
    .tk-daterange ion-icon { font-size: 15px; flex: 0 0 auto; }
    .tk-daterange ion-input { --background: transparent; --padding-start: 0; --padding-end: 0; --padding-top: 2px; --padding-bottom: 2px; --color: var(--color); min-height: 26px; width: 6.8rem; font-size: 13px; }
    .tk-daterange .arr { color: var(--color-muted); }

    /* Barra contextual de selección */
    .selbar { display: flex; align-items: center; gap: 0.6rem; padding: 0.4rem 0.7rem; border-radius: 10px;
      font-size: 13px; color: var(--primary);
      background: color-mix(in srgb, var(--primary) 12%, transparent); }
    .selbar .sel-clear { margin-left: auto; display: inline-flex; align-items: center; gap: 0.25rem; cursor: pointer; font-weight: 500; color: inherit; background: none; border: 0; font: inherit; }
    .selbar .sel-clear:hover { text-decoration: underline; }

    /* Acordeones (alta / filtros en modo tarjetas) */
    .panel { padding: 0.85rem 1rem; border-bottom: 1px solid var(--border-color); background: var(--header-background); }
    .filters-panel { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.6rem; }

    /* ── Vista lista en CSS GRID (no <table>): permite ancho por columna ──────────────────── */
    /* #67 — La barra horizontal es PERMANENTE cuando hay desbordamiento: la overlay de macOS se
       esconde a los pocos ms y deja la tabla sin ninguna pista de que sigue a la derecha. Al
       declarar ::-webkit-scrollbar el navegador pinta la clásica, que ocupa sitio y se ve. */
    .scroll { overflow-x: auto; }
    .scroll::-webkit-scrollbar { height: 10px; }
    .scroll::-webkit-scrollbar-track { background: transparent; }
    .scroll::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--color) 25%, transparent); border-radius: 6px; }
    .scroll::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--color) 40%, transparent); }
    /* #120 - The grid floor is the SUM OF THE COLUMN MINIMUMS (min-content), not its maximum
       size. With max-content the grid sizes itself to what the widest column asks for and, in
       doing so, every 1fr track ends up as wide AS THAT ONE: at 834px each column measured
       148.86px for content asking between 10px (a "4") and 100px ("Familia Perez"). The table
       always overflowed and the pinned actions column sat on top of Pax and Estado. With
       min-content the grid fits its container as long as the minimums fit, and 1fr shares out the
       leftover space; horizontal scroll shows up only when not even the minimums fit. */
    .grid { min-width: min-content; font-size: 14px; }
    .grow { display: grid; align-items: center; gap: 0.5rem; padding: 0 1rem; }
    .ghead { position: sticky; top: 0; z-index: 2; border-bottom: 1px solid var(--border-color);
      background: var(--header-background); padding-top: 0.55rem; padding-bottom: 0.55rem; }
    .gcell { display: flex; align-items: center; min-width: 0; }
    .gcell > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gcell.right { justify-content: flex-end; text-align: right; }
    .gcell.center { justify-content: center; text-align: center; }
    /* #67 - PINNED ACTIONS COLUMN. When the grid overflows (since #120 only when not even the
       column minimums fit; before that it happened with six columns and room to spare) the button
       that opens the record went off screen: at 1440px it sat 335px past the edge with nothing to
       give it away. It stays stuck to the right edge, like Zendesk/Freshdesk/Shopify. With
       background:inherit it takes the row background (which is opaque for this very reason), so it
       keeps hover and selection without anything showing through. */
    .gcell.actions-col { position: sticky; right: 0; z-index: 1; background: inherit;
      margin-right: -1rem; padding-right: 1rem; }
    /* La sombra solo aparece cuando de verdad hay algo escondido a la izquierda (clase x-overflow);
       si la tabla cabe entera no se pinta nada. */
    .scroll.x-overflow .gcell.actions-col { box-shadow: -10px 0 10px -10px color-mix(in srgb, var(--color) 45%, transparent); }
    /* #120 - The pinned header has to be OPAQUE. background:inherit took --header-background,
       which is a 4% alpha TINT (measured rgba(24,24,27,0.04)): when the grid overflows the
       "Acciones" header went see-through and "PAX" and "ESTADO" could be read through it - the
       "PAXCIONESTAD" of the issue. It now sits on the opaque table background with the tint laid
       back on top, the same way .grow-data:hover does. */
    .ghead .gcell.actions-col { z-index: 3;
      background: linear-gradient(var(--header-background), var(--header-background)), var(--background); }
    .gh { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-muted); }
    .gh.sortable { cursor: pointer; user-select: none; white-space: nowrap; transition: background-color var(--ok-transition, 150ms ease), color var(--ok-transition, 150ms ease), box-shadow var(--ok-transition, 150ms ease), transform 120ms ease; }
    @media (hover: hover) {
      .gh.sortable:hover { color: var(--color); }
    }
    /* Caret de orden (3 estados, icono Ionic): neutral atenuado / activo en color primario. */
    .caret { display: inline-flex; align-items: center; margin-left: 0.25rem; flex: 0 0 auto; font-size: 13px; opacity: 0.3; }
    .caret.on { opacity: 1; color: var(--primary); }
    .grow-data { background: var(--background); border-bottom: 1px solid var(--border-color-soft); padding-top: 0.6rem; padding-bottom: 0.6rem; transition: background-color var(--ok-transition, 150ms ease), color var(--ok-transition, 150ms ease), box-shadow var(--ok-transition, 150ms ease), transform 120ms ease; }
    .grow-data:last-child { border-bottom: 0; }
    @media (hover: hover) {
      .grow-data:hover { background: linear-gradient(var(--row-hover), var(--row-hover)), var(--background); }
    }
    .grow-data:active { transform: scale(0.995); }
    .grow-data.selected { background: linear-gradient(color-mix(in srgb, var(--primary) 10%, transparent), color-mix(in srgb, var(--primary) 10%, transparent)), var(--background); }
    /* #67 — Fila clicable (opt-in row-clickable): es lo primero que intenta el usuario y lo que
       hacen Odoo, Jira SM, Shopify o Square en sus listados. */
    .grow-data.clickable { cursor: pointer; }
    .grow-data.clickable:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
    .selcb { display: flex; align-items: center; justify-content: center; }
    .filters-grow { padding-top: 0.4rem; padding-bottom: 0.6rem; }
    .filters-grow input, .filters-grow select { width: 100%; box-sizing: border-box; font: inherit; font-size: 13px; padding: 0.3rem 0.4rem; border: 1px solid var(--border-color); border-radius: 6px; background: var(--background); color: var(--color); }
    .range { display: flex; gap: 0.25rem; }

    /* ── Vista tarjetas ──────────────────────────────────────────────────────────────────── */
    /* Cada tarjeta mide SU contenido (no se estira al alto de la fila ni del contenedor):
       - grid-auto-rows: max-content → cada fila implícita = alto de su contenido. CLAVE: sin esto,
         en modo fill (grid de alto fijo + align-content:start) cuando las tarjetas no caben el
         navegador encoge los tracks de fila y las tarjetas se solapan.
       - align-content: start → empaqueta las filas arriba (no reparte el hueco sobrante estirando).
       - align-items: start → en una fila multi-columna cada tarjeta mide su propio contenido.
       En modo fill el grid es flex-child con overflow:auto → cuando las tarjetas no caben aparece el
       scroll DENTRO de la tabla (no crece hacia fuera). */
    .cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 0.75rem; padding: 1rem; grid-auto-rows: max-content; align-content: start; align-items: start; }
    /* Tarjeta = ion-card NATIVO de Ionic: su fondo, radio, elevación y padding son los de Ionic y NO
       se sobrescriben. Aquí solo se ajusta lo que el contexto de rejilla exige (margin) y los huecos
       que Ionic no trae (cabecera en fila, filas clave-valor, barra de acciones, resalte de selección). */
    ion-card.rcard { margin: 0; } /* la rejilla aporta el gap → sin esto el margin por defecto de ion-card lo duplica */
    ion-card.rcard.selected { outline: 2px solid var(--primary); outline-offset: -2px; }
    /* #74 — Tarjeta clicable (opt-in row-clickable): la mitad de #67 que faltaba. La vista de
       tarjetas es la que la tabla elige SOLA en móvil, así que sin esto el registro no se podía
       abrir desde un teléfono (medido con combos 0.1.4: 0 rowClick a 390px). */
    ion-card.rcard.clickable { cursor: pointer; }
    ion-card.rcard.clickable:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
    @media (prefers-reduced-motion: reduce) {
      .gh.sortable:hover, .gh.sortable:active,
      .grow-data:hover, .grow-data:active { transform: none; }
    }
    /* Header: ion-card-header as a single row (icon + title + checkbox), keeping Ionic's padding.
       #79 — flex-direction/flex-wrap are SPELLED OUT on purpose: in ios mode (the mode the Hub
       shell pins, ADR-0143) Ionic's own host CSS gives ion-card-header a column direction, so a
       rule that only sets display:flex inherits it and the three children stack on three lines.
       Under md the same rule looked right, which is why it shipped. */
    ion-card-header.rcard-head { display: flex; flex-direction: row; flex-wrap: nowrap; align-items: center; gap: 0.5rem; }
    .rcard-head .rc-icon { display: inline-flex; color: var(--primary); }
    .rcard-head .rc-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    /* Cuerpo: ion-card-content (padding Ionic por defecto) con las filas clave-valor apiladas. */
    ion-card-content.rcard-body { display: flex; flex-direction: column; gap: 0.4rem; }
    .rrow { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 13px; }
    .rrow .rk { color: var(--color-muted); }
    .rrow .rv { font-weight: 500; text-align: right; color: var(--color); }
    /* Barra de acciones (Ionic no trae "card actions"): pie alineado a la derecha, fondo transparente. */
    .ractions { display: flex; justify-content: flex-end; gap: 0.25rem; padding: 0 0.5rem 0.5rem; }
    /* ERPlora/appointments#154 - a card's action row must NEVER clip.
       The assumption was that they always fit across the card. With the eight actions an
       appointment carries they do not: on a 411dp phone the card leaves 363px and the buttons ask
       for 380px (8 x 44px of tap floor + 7 gaps of 4px). Without wrapping, justify-content:
       flex-end takes that difference off the START side, so the FIRST button - Cobrar - hung off
       the left edge of the card, clipped, with no scrollbar and nothing to say it was there.
       The wrap is scoped to the card on purpose: the LIST view's row is measured by its
       scrollWidth to pin the column track (#121), and a row that wraps changes width with the
       track it is measured against, which is the loop that measure avoids. */
    .ractions .actions { flex-wrap: wrap; }

    /* ── Estado vacío ────────────────────────────────────────────────────────────────────── */
    .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem; padding: 3.5rem 1rem; text-align: center; color: var(--color-muted); }
    .empty .empty-ic { display: grid; place-items: center; width: 3.25rem; height: 3.25rem; border-radius: 999px; background: var(--header-background); font-size: 26px; }

    .actions { display: flex; gap: 0.25rem; justify-content: flex-end; }
    /* #121 - The buttons NEVER shrink. Their track is pinned to the width measured here
       (the scrollWidth of .actions); if they could shrink, a narrow track would shrink the
       measurement, which would shrink the track again. flex: 0 0 auto is what makes the
       measurement a property of the CONTENT instead of a property of the current layout. */
    .actions ion-button { flex: 0 0 auto; }
    /* #122 - Header of the actions column while the buttons are folded into the menu. "ACCIONES"
       measures 62.83px and the folded track is 44px: painted, it spills out of its own cell and
       over "Estado" - the very thing the issue is about. The column keeps its name for assistive
       tech and paints nothing. */
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
      clip-path: inset(50%); white-space: nowrap; border: 0; }
    /* Las acciones de fila son icon-only y de tamaño small en escritorio. En tablet/móvil se
     * amplía el host completo (no solo el icono) para que el área táctil alcance 44×44 px. */
    @media (pointer: coarse), (max-width: 834px) {
      .actions ion-button { min-width: 44px; min-height: 44px; margin: 0; }
      .toolbtn { width: 44px; height: 44px; }
      .add-btn { min-height: 44px; }
      .pager .nav ion-button { min-width: 44px; min-height: 44px; margin: 0; }
    }
    /* Spinner de acción en curso (loading): contenido dentro del ion-button small (Ionic lo fija
     * a 28px en el :host, por eso width/height y no font-size). Cubre tabla y tarjetas: los
     * botones de fila siempre van dentro de .actions. */
    .actions ion-spinner { width: 18px; height: 18px; }

    /* ── Pie: contador + paginación ──────────────────────────────────────────────────────── */
    .pager { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.55rem 1rem; border-top: 1px solid var(--border-color); background: var(--header-background); font-size: 12.5px; color: var(--color-muted); }
    .pager .left { display: flex; align-items: center; gap: 0.6rem; }
    .pager .strong { font-weight: 600; color: var(--color); }
    .psize { font: inherit; font-size: 12.5px; padding: 0.2rem 0.35rem; border: 1px solid var(--border-color); border-radius: 6px; background: var(--background); color: var(--color); }
    .pager .nav { display: flex; align-items: center; gap: 0.2rem; }
    /* #78 — Pie en MÓVIL: un solo control «Cargar más» en lugar del pager numerado (Shopify
       IndexTable, Fresha, Square y Material hacen lo mismo: nadie pinta botones de página en un
       teléfono). Sin atributo fill: el sólido por defecto de Ionic es el único que pinta caja en
       modo ios (outfitkit#82 / ADR-0143). Los 44px son el área táctil mínima. */
    .pager .load-more { min-height: 44px; margin: 0; --padding-start: 1rem; --padding-end: 1rem; font-size: 13px; }
    .pager .nav .pp { font-weight: 600; color: var(--color); padding: 0 0.25rem; }
    /* Pager numerado: botón por página + «…» en los saltos (look del Hub). */
    /* #92 — min-width/height at 44px so a numbered page button matches the prev/next ion-button's
       own 44px tap target (line above): before this they were visibly smaller than their neighbors. */
    .pnum { min-width: var(--ok-tap-min, 44px); height: var(--ok-tap-min, 44px); padding: 0 0.4rem; border: 1px solid transparent; border-radius: 8px; background: none; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--color); cursor: pointer; transition: background 0.12s, border-color 0.12s; }
    .pnum:hover { background: var(--row-hover); }
    .pnum.on { background: color-mix(in srgb, var(--primary) 14%, transparent); color: var(--primary); border-color: color-mix(in srgb, var(--primary) 40%, transparent); }
    .pgap { padding: 0 0.15rem; color: var(--color-muted); }
    ion-button { --box-shadow: none; }
  `;
  }
  static {
    this.MOBILE_BREAKPOINT = 640;
  }
  connectedCallback() {
    super.connectedCallback();
    if (typeof window !== "undefined") {
      window.addEventListener("erplora:locale-changed", this.onLocaleChanged);
      window.addEventListener("resize", this.onWindowResize);
    }
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      this.mq = window.matchMedia(`(max-width: ${_OkDataTable2.MOBILE_BREAKPOINT}px)`);
      this.isMobile = this.mq.matches;
      const handler = (e5) => {
        const matches = "matches" in e5 ? e5.matches : this.mq?.matches ?? false;
        if (this.isMobile === matches) return;
        this.isMobile = matches;
        if (matches && this.cardViewEnabled) this.viewMode = "cards";
        else if (!matches && this.viewMode === "cards") this.viewMode = "table";
      };
      this.mq.addEventListener("change", handler);
      this._mqHandler = handler;
    }
  }
  /** #67 — Recalcula si la vista lista desborda a lo ancho (`scrollWidth > clientWidth`).
   *
   * Se mide después de renderizar, que es cuando el navegador ya conoce los anchos, y solo se
   * escribe el estado si CAMBIA: asignarlo siempre reprogramaría un render en bucle. */
  measureXOverflow() {
    const scroll = this.renderRoot?.querySelector?.(".scroll");
    const overflow = !!scroll && scroll.scrollWidth > scroll.clientWidth;
    if (this.xOverflow !== overflow) this.xOverflow = overflow;
  }
  /** #121 — Ancho natural de los botones de acción de una fila, para clavar su pista en px.
   *
   * Se lee del `scrollWidth` de `.actions`, que es el ancho de SU CONTENIDO: como los botones
   * llevan `flex: 0 0 auto` nunca se encogen, así que la medida no depende de lo ancha que sea la
   * pista en ese momento. Eso es lo que la hace estable: clavar la pista al ancho natural no
   * cambia el ancho natural, así que la siguiente medida sale igual y no hay bucle. */
  measureActionsTrack() {
    if (!this.actions.length) {
      if (this.actionsTrackPx !== 0) this.actionsTrackPx = 0;
      return;
    }
    const el = this.renderRoot?.querySelector?.(".grow-data .gcell.actions-col .actions");
    const width = el ? Math.ceil(el.scrollWidth) : 0;
    if (width > 0 && width !== this.actionsTrackPx) this.actionsTrackPx = width;
  }
  /** #122 — Decide si los botones de acción de la fila caben o se pliegan en el menú «⋮».
   *  El criterio y la garantía de que no oscila viven en `decideRowActionsFit`. */
  measureRowActionsFit() {
    const scroll = this.renderRoot?.querySelector?.(".scroll");
    if (!scroll) return;
    const next = decideRowActionsFit({
      containerWidth: scroll.clientWidth,
      contentWidth: scroll.scrollWidth,
      collapsed: this.rowActionsCollapsed,
      decidedAtWidth: this.fitDecidedAtWidth
    });
    this.fitDecidedAtWidth = next.decidedAtWidth;
    if (this.rowActionsCollapsed !== next.collapsed) this.rowActionsCollapsed = next.collapsed;
  }
  /** Engancha el observador al contenedor de scroll del render actual (cambia entre vistas). */
  observeXOverflow() {
    if (typeof ResizeObserver === "undefined") return;
    const scroll = this.renderRoot?.querySelector?.(".scroll");
    if (!scroll) return;
    this.xObserver ??= new ResizeObserver(() => {
      this.measureXOverflow();
      this.measureActionsTrack();
      this.measureRowActionsFit();
    });
    this.xObserver.disconnect();
    this.xObserver.observe(scroll);
    const grid = scroll.querySelector(".grid");
    if (grid) this.xObserver.observe(grid);
  }
  updated(changed) {
    this.observeXOverflow();
    this.measureXOverflow();
    if (changed.has("columns") || changed.has("actions") || changed.has("hiddenKeys") || changed.has("selectable")) {
      this.fitDecidedAtWidth = -1;
    }
    this.measureActionsTrack();
    this.measureRowActionsFit();
    if (changed.has("panel")) this.syncSheetTop();
  }
  /** #75 — Where the mobile sheet starts. `position: fixed; inset: 0` painted it from y=0 and the
   *  app's `ion-header` (its own stacking context, above the content) covered the sheet's title and
   *  its only Close button — measured at 390×844 in the Appointments parity page. CSS inside a
   *  shadow root cannot know where the content area begins, so on open the table measures the
   *  closest `ion-content` (walking through shadow hosts) and hands the offset over as a custom
   *  property; on close it is removed. Without an `ion-content` around, the sheet keeps y=0. */
  syncSheetTop() {
    if (this.panel === "none") {
      this.style.removeProperty("--ok-sheet-top");
      return;
    }
    let node = this;
    let content = null;
    while (node && !content) {
      const parent = node.parentNode ?? node.getRootNode?.()?.host ?? null;
      if (parent && parent.nodeType === Node.ELEMENT_NODE && parent.tagName === "ION-CONTENT") content = parent;
      node = parent === node ? null : parent;
    }
    const top = content ? Math.max(0, Math.round(content.getBoundingClientRect().top)) : 0;
    this.style.setProperty("--ok-sheet-top", `${top}px`);
  }
  disconnectedCallback() {
    if (typeof window !== "undefined") {
      window.removeEventListener("erplora:locale-changed", this.onLocaleChanged);
      window.removeEventListener("resize", this.onWindowResize);
    }
    this.xObserver?.disconnect();
    this.xObserver = void 0;
    if (this.mq) {
      const handler = this._mqHandler;
      if (handler) this.mq.removeEventListener("change", handler);
      this.mq = void 0;
    }
    super.disconnectedCallback();
  }
  // ── i18n: idioma del documento ← overrides explícitos de `.labels` ─────────────────────────
  get t() {
    const lang = typeof document === "undefined" ? "en" : document.documentElement.lang.toLowerCase();
    return { ...lang.startsWith("es") ? ES_LABELS : DEFAULT_LABELS2, ...this.labels };
  }
  /** Placeholder efectivo del buscador (prop explícita → label i18n → default inglés). */
  get effSearchPlaceholder() {
    return this.searchPlaceholder ?? this.t.search;
  }
  /** Mensaje efectivo de estado vacío (prop explícita → label i18n → default inglés). */
  get effEmptyMessage() {
    return this.emptyMessage ?? this.t.empty;
  }
  // ── Resolución de alias (compat + documentados) ──────────────────────────────────────────
  get effPageSizes() {
    return this.pageSizes ?? this.pageSizeOptions;
  }
  get effColumnPicker() {
    return this.columnPicker || this.columnSelector;
  }
  get effExport() {
    return this.csv || this.exportable;
  }
  get effImport() {
    return this.csv || this.importable;
  }
  /** ¿Está habilitado el conmutador de vista lista/tarjetas? */
  get viewToggle() {
    if (Array.isArray(this.views)) return this.views.length > 1;
    return this.views === true;
  }
  /** ¿Está disponible la vista tarjetas? (presente en `views` o `views === true`). */
  get cardViewEnabled() {
    if (Array.isArray(this.views)) return this.views.some((v3) => v3 === "cards" || v3 === "card");
    return this.views === true;
  }
  /** Columnas actualmente visibles (respeta el column chooser). */
  get visibleColumns() {
    return this.hiddenKeys.size ? this.columns.filter((c5) => !this.hiddenKeys.has(c5.key)) : this.columns;
  }
  setVisibleColumns(keys) {
    const visible = new Set(keys);
    this.hiddenKeys = new Set(this.columns.map((c5) => c5.key).filter((k2) => !visible.has(k2)));
    this.emit("columnsChange", { visible: keys });
  }
  // ── Selección ─────────────────────────────────────────────────────────────────────────────
  keyOf(row) {
    if (typeof this.rowKey === "function") return String(this.rowKey(row) ?? "");
    if (typeof this.rowKey === "string") return String(row[this.rowKey] ?? "");
    return String(row[this.rowKeyField] ?? "");
  }
  /** #143 — `<prefix>-<suffix>`, or `nothing` (= the attribute is not painted) when the host gave
   *  no prefix. A blank prefix counts as absent: `" "` would leave dangling `-add` hooks, identical
   *  on every table of the screen, which is exactly what the prefix prevents. */
  tid(suffix) {
    const prefix = this.testid?.trim();
    return prefix ? `${prefix}-${suffix}` : A;
  }
  get selection() {
    return this.selectedKeys ?? this.internalSelection;
  }
  setSelection(next) {
    if (!this.selectedKeys) this.internalSelection = next;
    this.emit("selectionChange", { keys: [...next] });
    this.requestUpdate();
  }
  toggleRow(key) {
    const next = new Set(this.selection);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.setSelection(next);
  }
  toggleAll(visible) {
    const keys = visible.map((r6) => this.keyOf(r6));
    const allOn = keys.length > 0 && keys.every((k2) => this.selection.has(k2));
    const next = new Set(this.selection);
    if (allOn) keys.forEach((k2) => next.delete(k2));
    else keys.forEach((k2) => next.add(k2));
    this.setSelection(next);
  }
  // ── CSV ─────────────────────────────────────────────────────────────────────────────────────
  csvEscape(v3) {
    const s5 = v3 === null || v3 === void 0 ? "" : String(v3);
    return /[",\n\r]/.test(s5) ? `"${s5.replace(/"/g, '""')}"` : s5;
  }
  /** Exporta las filas a CSV (cabeceras = column.key). Si no hay filas, exporta solo la estructura. */
  exportCsv() {
    const cols = this.columns;
    const head = cols.map((c5) => this.csvEscape(c5.key)).join(",");
    const lines = this.rows.map((r6) => cols.map((c5) => this.csvEscape(r6[c5.key])).join(","));
    const csv = [head, ...lines].join("\r\n");
    const blob = new Blob([CSV_BOM + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a3 = document.createElement("a");
    a3.href = url;
    a3.download = this.csvName;
    a3.click();
    URL.revokeObjectURL(url);
    this.emit("csvExport", { rows: this.rows.length });
    this.emit("export", { rows: this.rows.length });
  }
  parseCsv(text) {
    const out = [];
    let row = [];
    let field = "";
    let q = false;
    for (let i7 = 0; i7 < text.length; i7++) {
      const c5 = text[i7];
      if (q) {
        if (c5 === '"') {
          if (text[i7 + 1] === '"') {
            field += '"';
            i7++;
          } else q = false;
        } else field += c5;
      } else if (c5 === '"') q = true;
      else if (c5 === ",") {
        row.push(field);
        field = "";
      } else if (c5 === "\n" || c5 === "\r") {
        if (c5 === "\r" && text[i7 + 1] === "\n") i7++;
        row.push(field);
        field = "";
        if (row.length > 1 || row[0] !== "") out.push(row);
        row = [];
      } else field += c5;
    }
    if (field !== "" || row.length) {
      row.push(field);
      out.push(row);
    }
    const headers = out.shift() ?? [];
    const rows5 = out.map((r6) => Object.fromEntries(headers.map((h4, i7) => [h4, r6[i7] ?? ""])));
    return { headers, rows: rows5 };
  }
  async onImportFile(ev) {
    const input = ev.target;
    const file = input.files?.[0];
    if (!file) return;
    const text = decodeCsvBuffer(await file.arrayBuffer());
    const { headers, rows: rows5 } = this.parseCsv(text);
    this.emit("csvImport", { headers, rows: rows5 });
    this.emit("import", { headers, rows: rows5 });
    input.value = "";
  }
  toggle(p4) {
    if (p4 === "filters" && this.panel !== "filters") {
      this.filterDraft = this.cloneFilters(this.clientFilters);
    }
    this.panel = this.panel === p4 ? "none" : p4;
  }
  // ── Filtros en memoria (modo cliente): borrador → aplicar. ───────────────────────────────────
  cloneFilters(src) {
    const out = {};
    for (const [k2, f3] of Object.entries(src)) {
      out[k2] = { values: f3.values ? new Set(f3.values) : void 0, from: f3.from, to: f3.to };
    }
    return out;
  }
  // Fija el conjunto de valores seleccionados de una columna (multi-select del drawer = ion-select).
  setFilterValues(key, values) {
    const next = this.cloneFilters(this.filterDraft);
    const clean = (values ?? []).filter((v3) => v3 != null && v3 !== "");
    if (clean.length) next[key] = { ...next[key], values: new Set(clean) };
    else next[key] = { ...next[key], values: void 0 };
    this.filterDraft = next;
  }
  setFilterRange(key, edge, value) {
    const next = this.cloneFilters(this.filterDraft);
    next[key] = { ...next[key], [edge]: value };
    this.filterDraft = next;
  }
  applyFilters() {
    const clean = {};
    for (const [k2, f3] of Object.entries(this.filterDraft)) {
      if (f3.values && f3.values.size > 0 || f3.from || f3.to) clean[k2] = f3;
    }
    this.clientFilters = clean;
    this.clientPage = 0;
    this.mobileShown = 0;
    this.panel = "none";
    this.emit("filterChange", { filters: this.serializeFilters(clean) });
  }
  clearFilters() {
    this.filterDraft = {};
  }
  serializeFilters(src) {
    const out = {};
    for (const [k2, f3] of Object.entries(src)) {
      if (f3.values && f3.values.size > 0) out[k2] = [...f3.values];
      else if (f3.from || f3.to) out[k2] = { from: f3.from ?? "", to: f3.to ?? "" };
    }
    return out;
  }
  /** Abre el panel lateral (API pública para el módulo, p.ej. "editar" abre el form pre-rellenado). */
  open(panel = "create") {
    this.panel = panel;
  }
  /** Cierra el panel lateral. */
  close() {
    this.panel = "none";
  }
  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
  get hasSearch() {
    return this.searchable || this.searchKeys.length > 0;
  }
  /** Columnas filtrables (con control en el panel de filtros). En cliente y en servidor. */
  get filterColumns() {
    return this.columns.filter((c5) => c5.filterable);
  }
  /** ¿Hay que mostrar el botón de Filtros? (cualquier columna filtrable). */
  get hasFilterRow() {
    return this.filterColumns.length > 0;
  }
  /** Nº de filtros activos → badge del botón Filtros. En servidor cuenta `filterValues` (#106): sin
   *  esto el embudo no daba NINGUNA señal de que la lista venía acotada. */
  get activeFilterCount() {
    if (this.serverSide) {
      return Object.keys(this.serverFilters).filter((k2) => this.serverFilterState(k2) !== void 0).length;
    }
    return Object.values(this.clientFilters).filter(
      (f3) => f3.values && f3.values.size > 0 || f3.from || f3.to
    ).length;
  }
  // ── Estado de filtro VISIBLE (#106) ──────────────────────────────────────────────────────────
  /** Traduce un valor de `filterValues` (la forma que emite `filterChange`) a la forma interna que
   *  usan los `render*Filter`. `undefined` = ese filtro no está puesto. */
  serverFilterState(key) {
    const raw = this.serverFilters[key];
    if (raw === void 0 || raw === null || raw === "") return void 0;
    if (Array.isArray(raw)) {
      const values = raw.filter((v3) => v3 !== null && v3 !== void 0 && v3 !== "").map((v3) => String(v3));
      return values.length ? { values: new Set(values) } : void 0;
    }
    if (typeof raw === "object") {
      const range = raw;
      const from = range.from === null || range.from === void 0 || range.from === "" ? void 0 : String(range.from);
      const to = range.to === null || range.to === void 0 || range.to === "" ? void 0 : String(range.to);
      return from !== void 0 || to !== void 0 ? { from, to } : void 0;
    }
    return { values: /* @__PURE__ */ new Set([String(raw)]) };
  }
  /** Estado de filtro efectivo de una columna: servidor → `filterValues`/espejo; cliente → memoria. */
  filterStateOf(key) {
    return this.serverSide ? this.serverFilterState(key) : this.clientFilters[key];
  }
  /** Fija (o borra) el valor visible de un filtro en el espejo de servidor. */
  setServerFilter(key, value) {
    const next = { ...this.serverFilters };
    const empty = value === void 0 || value === null || value === "" || Array.isArray(value) && value.length === 0;
    if (empty) delete next[key];
    else next[key] = value;
    this.serverFilters = next;
  }
  /** Fija UN extremo de un rango en el espejo. Los dos extremos viajan en eventos SEPARADOS
   *  (`{from}` y luego `{to}`), así que aquí se MEZCLA: reemplazar borraría el otro extremo. */
  setServerRangeEdge(key, edge, value) {
    const prev = this.serverFilters[key];
    const base = prev && typeof prev === "object" && !Array.isArray(prev) ? { ...prev } : {};
    base[edge] = value;
    const alive = (v3) => v3 !== void 0 && v3 !== null && v3 !== "";
    this.setServerFilter(key, alive(base.from) || alive(base.to) ? base : void 0);
  }
  /** Valor crudo de una columna para ordenar/filtrar (usa format si lo hay, si no row[key]). */
  rawValue(col, row) {
    if (col.format) return col.format(row);
    return row[col.key];
  }
  /** Valores distintos de una columna (para los chips del filtro multi-select). */
  distinctValues(col) {
    const set = /* @__PURE__ */ new Set();
    for (const row of this.rows) {
      const v3 = this.rawValue(col, row);
      if (v3 != null && v3 !== "") set.add(String(v3));
    }
    return [...set].sort((a3, b3) => a3.localeCompare(b3));
  }
  /** Filas tras buscar + filtrar + ordenar EN MEMORIA (solo modo cliente). */
  get clientFiltered() {
    let result = this.rows;
    const needle = this.q.trim().toLowerCase();
    if (needle && this.searchKeys.length) {
      result = result.filter(
        (r6) => this.searchKeys.some((k2) => String(r6[k2] ?? "").toLowerCase().includes(needle))
      );
    }
    const fkeys = Object.keys(this.clientFilters);
    if (fkeys.length) {
      result = result.filter(
        (row) => fkeys.every((key) => {
          const f3 = this.clientFilters[key];
          const col = this.columns.find((c5) => c5.key === key);
          if (!col) return true;
          if (f3.values && f3.values.size > 0) {
            return f3.values.has(String(this.rawValue(col, row) ?? ""));
          }
          if (f3.from || f3.to) {
            const raw = this.rawValue(col, row);
            const t5 = raw == null ? NaN : new Date(raw).getTime();
            const from = f3.from ? new Date(f3.from).getTime() : -Infinity;
            const to = f3.to ? new Date(f3.to).getTime() + 864e5 - 1 : Infinity;
            return !Number.isNaN(t5) && t5 >= from && t5 <= to;
          }
          return true;
        })
      );
    }
    if (this.clientSort) {
      const col = this.columns.find((c5) => c5.key === this.clientSort);
      if (col) {
        const dir = this.clientSortDir === "asc" ? 1 : -1;
        result = [...result].sort((a3, b3) => {
          const va = this.rawValue(col, a3);
          const vb = this.rawValue(col, b3);
          if (va == null) return 1;
          if (vb == null) return -1;
          if (va < vb) return -1 * dir;
          if (va > vb) return 1 * dir;
          return 0;
        });
      }
    }
    return result;
  }
  cell(col, row) {
    if (col.format) return col.format(row);
    const v3 = row[col.key];
    return v3 === null || v3 === void 0 ? "" : String(v3);
  }
  /** ¿Es ordenable la columna? Servidor: opt-in (`sortable`). Cliente: por defecto SÍ (como el Hub),
   *  salvo `sortable: false` explícito. */
  isSortable(col) {
    return this.serverSide ? !!col.sortable : col.sortable !== false;
  }
  onHeaderClick(col) {
    if (!this.isSortable(col)) return;
    if (this.serverSide) {
      const dir = this.sort === col.key && this.sortDir === "asc" ? "desc" : "asc";
      this.emit("sortChange", { sort: col.key, dir });
      return;
    }
    this.mobileShown = 0;
    if (this.clientSort === col.key) {
      this.clientSortDir = this.clientSortDir === "asc" ? "desc" : "asc";
    } else {
      this.clientSort = col.key;
      this.clientSortDir = "asc";
    }
  }
  onFilterInput(col, ev) {
    const value = ev.target.value ?? "";
    this.setServerFilter(col.key, value);
    this.emit("filterChange", { col: col.key, value });
  }
  onRangeInput(col, edge, ev) {
    const raw = ev.target.value ?? "";
    const v3 = raw === "" ? "" : Number(raw);
    this.setServerRangeEdge(col.key, edge, v3);
    this.emit("filterChange", { col: col.key, value: { [edge]: v3 } });
  }
  onDateRangeInput(col, edge, ev) {
    const v3 = ev.target.value ?? "";
    this.setServerRangeEdge(col.key, edge, v3);
    this.emit("filterChange", { col: col.key, value: { [edge]: v3 } });
  }
  // ── Filtros EN LÍNEA (toolbar) ────────────────────────────────────────────────────────────
  // En modo cliente escriben directamente `clientFilters` (filtran en memoria); en servidor solo
  // emiten `filterChange`. Reutilizan la misma forma de filtro que el drawer (values / from / to).
  setClientFilter(key, patch) {
    const next = { ...this.clientFilters };
    const merged = { ...next[key], ...patch };
    const empty = (!merged.values || merged.values.size === 0) && !merged.from && !merged.to;
    if (empty) delete next[key];
    else next[key] = merged;
    this.clientFilters = next;
    this.clientPage = 0;
    this.mobileShown = 0;
  }
  // ion-select (select/multiselect) del panel de filtros (renderFilterControl). En servidor emite
  // `filterChange`; en cliente escribe `clientFilters` (multiselect ⇒ filtra por inclusión).
  onFilterSelect(col, value, multi) {
    if (this.serverSide) {
      const next = value ?? (multi ? [] : "");
      this.setServerFilter(col.key, next);
      this.emit("filterChange", { col: col.key, value: next });
      return;
    }
    if (multi) {
      const arr = Array.isArray(value) ? value.map((v3) => String(v3)) : value != null && value !== "" ? [String(value)] : [];
      this.setClientFilter(col.key, { values: arr.length ? new Set(arr) : void 0 });
    } else {
      const v3 = String(value ?? "");
      this.setClientFilter(col.key, { values: v3 ? /* @__PURE__ */ new Set([v3]) : void 0 });
    }
  }
  onInlineRange(col, edge, ev) {
    const v3 = ev.target.value ?? "";
    if (this.serverSide) {
      this.setServerRangeEdge(col.key, edge, v3);
      this.emit("filterChange", { col: col.key, value: { [edge]: v3 } });
      return;
    }
    this.setClientFilter(col.key, { [edge]: v3 || void 0 });
  }
  // Menú overflow: ancla el popover al botón vía el evento de click (compatible con Shadow DOM).
  openMenu(ev) {
    this.menuEv = ev;
    this.menuOpen = true;
  }
  /** #122 — Abre el menú «⋮» de UNA fila. Un solo popover para toda la tabla (uno por fila serían
   *  tantos como filas), anclado por evento porque `trigger` no resuelve dentro de Shadow DOM. */
  openRowMenu(ev, row) {
    ev.stopPropagation();
    this.rowMenuEv = ev;
    this.rowMenuRow = row;
    this.rowMenuOpen = true;
  }
  /** #122 — Las mismas acciones de la fila, como lista. Respeta `disabled`/`loading` por fila: una
   *  acción que no se puede pulsar en su botón tampoco se puede pulsar aquí. */
  renderRowMenu() {
    const row = this.rowMenuRow;
    if (!this.actions.length || !row) return A;
    const key = this.keyOf(row);
    return b2`
      <ion-popover
        class="row-menu"
        .isOpen=${this.rowMenuOpen}
        .event=${this.rowMenuEv}
        dismiss-on-select="true"
        @didDismiss=${() => this.rowMenuOpen = false}
      >
        <ion-content>
          <ion-list lines="none">
            ${this.actions.map((a3) => {
      const disabled = a3.loading?.(row) === true || a3.disabled?.(row) === true;
      const label = typeof a3.label === "function" ? a3.label(row) : a3.label;
      return b2`
                <!-- #143 — The action is named the SAME collapsed or not, so one spec works at any
                     width. It carries the hook only while the direct buttons are NOT there: the
                     popover survives its dismissal («rowMenuRow» is not cleared), and if the table
                     widened again there would be TWO elements with the hook and «getByTestId»
                     would pick one at random. -->
                <ion-item
                  button
                  data-testid=${this.rowActionsCollapsed ? this.tid(`row-${key}-${a3.id}`) : A}
                  ?disabled=${disabled}
                  aria-disabled=${disabled ? "true" : A}
                  .detail=${false}
                  @click=${() => {
        if (disabled) return;
        this.rowMenuOpen = false;
        this.emit("rowAction", { actionId: a3.id, row });
      }}
                >
                  ${a3.icon ? b2`<ion-icon slot="start" .icon=${okIcon(a3.icon)} color=${a3.color ?? A}></ion-icon>` : A}
                  <ion-label color=${a3.color ?? A}>${label}</ion-label>
                </ion-item>
              `;
    })}
          </ion-list>
        </ion-content>
      </ion-popover>
    `;
  }
  // Aplica la vista inicial declarada (`default-view`) una sola vez, tras el primer render. Es la
  // forma robusta de arrancar en tarjetas sin depender de fijar `viewMode` por referencia (que
  // falla si la tabla monta detrás de un `v-if`/loading y el ref aún es null).
  firstUpdated() {
    this.applyInitialView();
  }
  /** Re-evalúa la vista inicial cada render mientras el usuario no haya elegido a mano.
   *
   * `firstUpdated` NO basta: decide una sola vez, y los consumidores que asignan las props por JS
   * DESPUÉS de insertar el elemento —lo normal en páginas renderizadas por el servidor— llegan
   * tarde. En ese momento `cardViewEnabled` aún era `false`, así que no se conmutaba; y el
   * listener de `matchMedia` solo dispara al CAMBIAR el viewport, cosa que en un móvil no pasa
   * nunca. La tabla se quedaba con scroll lateral para siempre.
   *
   * Medido en Android contra producción el 2026-08-02 con el bundle ya actualizado:
   *   `views` antes de insertar  → tarjetas
   *   `views` después de insertar → tabla   ← lo que hace la página
   */
  willUpdate(changed) {
    this.applyInitialView();
    if (changed.has("filterValues")) this.serverFilters = { ...this.filterValues ?? {} };
    if (changed.has("search") && this.search !== void 0) {
      this.q = this.search;
      if (!this.serverSide) {
        this.clientPage = 0;
        this.mobileShown = 0;
      }
    }
    if (!this.serverSide && changed.has("rows") && this.mobileShown !== 0) this.mobileShown = 0;
  }
  applyInitialView() {
    if (this.viewChosenByUser) return;
    if (this.isMobile && this.cardViewEnabled) {
      this.viewMode = "cards";
    } else if (this.defaultView === "cards" && this.cardViewEnabled) {
      this.viewMode = "cards";
    } else if (this.defaultView === "table") {
      this.viewMode = "table";
    }
  }
  setViewMode(mode) {
    this.viewChosenByUser = true;
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    this.emit("viewChange", mode);
  }
  // Control de filtro de una columna, con componentes Ionic (mismos inputs que el form de alta).
  renderFilterControl(col) {
    if (!col.filterable) return A;
    const type = col.filterType ?? "text";
    const f3 = this.filterStateOf(col.key);
    if (type === "select" || type === "multiselect") {
      const multi = type === "multiselect";
      const opts = col.options ?? this.distinctValues(col).map((v3) => ({ value: v3, label: v3 }));
      const current = this.selectValue(f3, multi);
      return b2`
        <ion-select
          label=${col.header}
          label-placement="stacked"
          fill="outline" mode="md"
          ?multiple=${multi}
          interface="modal"
          .interfaceOptions=${{ cssClass: "ok-overlay" }}
          placeholder=${this.t.select}
          .value=${current}
          @ionChange=${(e5) => this.onFilterSelect(col, e5.detail.value, multi)}
        >
          ${multi ? A : b2`<ion-select-option value="">${this.t.select}</ion-select-option>`}
          ${opts.map((o7) => b2`<ion-select-option value=${o7.value}>${o7.label}</ion-select-option>`)}
        </ion-select>
      `;
    }
    if (type === "range" || type === "daterange") {
      const t5 = type === "daterange" ? "date" : "number";
      const onEdge = type === "daterange" ? this.onDateRangeInput.bind(this) : this.onRangeInput.bind(this);
      return b2`
        <div class="fblock">
          <span class="flabel">${col.header}</span>
          <div class="frange">
            <ion-input type=${t5} fill="outline" mode="md" placeholder=${type === "daterange" ? this.t.from : this.t.gte}
              .value=${f3?.from ?? ""}
              @ionInput=${(e5) => onEdge(col, "from", e5)}></ion-input>
            <ion-input type=${t5} fill="outline" mode="md" placeholder=${type === "daterange" ? this.t.to : this.t.lte}
              .value=${f3?.to ?? ""}
              @ionInput=${(e5) => onEdge(col, "to", e5)}></ion-input>
          </div>
        </div>
      `;
    }
    const inputType = type === "number" ? "number" : type === "date" ? "date" : "text";
    return b2`
      <ion-input
        type=${inputType}
        fill="outline" mode="md"
        label=${col.header}
        label-placement="stacked"
        placeholder=${this.t.filterPlaceholder}
        .value=${this.selectValue(f3, false)}
        @ionInput=${(e5) => this.onFilterInput(col, e5)}
      ></ion-input>
    `;
  }
  /** Valor para un control de un solo valor (`ion-select`/`ion-input`) o multi (`ion-select
   *  multiple`) a partir del estado de filtro interno. '' / [] = sin filtro. */
  selectValue(f3, multi) {
    const values = [...f3?.values ?? /* @__PURE__ */ new Set()];
    if (multi) return values;
    return values.length ? values[0] : "";
  }
  // Controles de filtro COMPACTOS para la toolbar (modo `inlineFilters`). Solo select y rango de
  // fechas (los del screenshot); el resto de tipos siguen disponibles vía el drawer si no se activa
  // `inlineFilters`. Look: «Todos los Estados» (placeholder) / «01/10/25 → 18/10/25».
  renderInlineFilters() {
    const cols = this.filterColumns.filter((c5) => {
      const t5 = c5.filterType ?? "text";
      return t5 === "select" || t5 === "multiselect" || t5 === "date" || t5 === "daterange";
    });
    if (!cols.length) return A;
    return b2`${cols.map((c5) => this.renderInlineFilter(c5))}`;
  }
  renderInlineFilter(col) {
    const type = col.filterType ?? "text";
    const f3 = this.filterStateOf(col.key);
    if (type === "select" || type === "multiselect") {
      const multi = type === "multiselect";
      const opts = col.options ?? this.distinctValues(col).map((v3) => ({ value: v3, label: v3 }));
      const current = this.selectValue(f3, multi);
      return b2`
        <ion-select
          class="tk-filter"
          ?multiple=${multi}
          interface="modal"
          .interfaceOptions=${{ cssClass: "ok-overlay" }}
          aria-label=${col.header}
          placeholder=${col.header}
          .value=${current}
          @ionChange=${(e5) => this.onFilterSelect(col, e5.detail.value, multi)}
        >
          ${multi ? A : b2`<ion-select-option value="">${col.header}</ion-select-option>`}
          ${opts.map((o7) => b2`<ion-select-option value=${o7.value}>${o7.label}</ion-select-option>`)}
        </ion-select>
      `;
    }
    return b2`
      <span class="tk-daterange" role="group" aria-label=${col.header}>
        <ion-icon .icon=${iconCalendarOutline}></ion-icon>
        <ion-input type="date" aria-label=${this.t.fromOf.replace("{label}", col.header)} .value=${f3?.from ?? ""} @ionChange=${(e5) => this.onInlineRange(col, "from", e5)}></ion-input>
        <span class="arr">→</span>
        <ion-input type="date" aria-label=${this.t.toOf.replace("{label}", col.header)} .value=${f3?.to ?? ""} @ionChange=${(e5) => this.onInlineRange(col, "to", e5)}></ion-input>
      </span>
    `;
  }
  // Menú overflow («⋮») con ion-popover anclado por evento (Shadow-DOM-safe).
  renderOverflowMenu() {
    if (!this.menuActions.length) return A;
    return b2`
      <ion-button class="toolbtn" fill="clear" aria-label=${this.t.moreActions} @click=${(e5) => this.openMenu(e5)}>
        <ion-icon slot="icon-only" .icon=${iconEllipsisVertical}></ion-icon>
      </ion-button>
      <ion-popover
        .isOpen=${this.menuOpen}
        .event=${this.menuEv}
        dismiss-on-select="true"
        @didDismiss=${() => this.menuOpen = false}
      >
        <ion-content>
          <ion-list lines="none">
            ${this.menuActions.map(
      (a3) => b2`
                <ion-item button .detail=${false} @click=${() => {
        this.menuOpen = false;
        this.emit("menuAction", { actionId: a3.id });
      }}>
                  ${a3.icon ? b2`<ion-icon slot="start" .icon=${okIcon(a3.icon)} color=${a3.color ?? A}></ion-icon>` : A}
                  <ion-label color=${a3.color ?? A}>${a3.label}</ion-label>
                </ion-item>
              `
    )}
          </ion-list>
        </ion-content>
      </ion-popover>
    `;
  }
  // Row action buttons, shared by the table and the card views.
  //
  // `collapsible` = the LIST view, the only one that folds its buttons into a "⋮" menu when the
  // columns leave it no width (#122). The CARD view does not fold; it WRAPS instead, see
  // `.ractions .actions` in the stylesheet.
  //
  // This comment used to claim that a card's actions "always fit across the card". They do not,
  // and nobody had measured it (#132 / ERPlora/appointments#154): with the eight actions an
  // appointment carries, the row asks for 380px and the card gives 379px at 411dp, 237px at 768px
  // and 272px at 1440px — so the first button hung off the card at ALL THREE widths, not just on
  // a phone. If you add a view that lays these buttons out, MEASURE it.
  actionButtons(row, collapsible = false) {
    if (!this.actions.length) return A;
    const key = this.keyOf(row);
    if (collapsible && this.rowActionsCollapsed) {
      return b2`
        <div class="actions">
          <ion-button
            size="small"
            fill="clear"
            color="medium"
            data-testid=${this.tid(`row-${key}-menu`)}
            aria-label=${this.t.moreActions}
            title=${this.t.moreActions}
            aria-haspopup="menu"
            @click=${(e5) => this.openRowMenu(e5, row)}
          >
            <ion-icon slot="icon-only" .icon=${okIcon(iconEllipsisVertical)}></ion-icon>
          </ion-button>
        </div>
      `;
    }
    return b2`
      <div class="actions">
        ${this.actions.map(
      (a3) => {
        const loading = a3.loading?.(row) === true;
        const disabled = loading || a3.disabled?.(row) === true;
        const label = typeof a3.label === "function" ? a3.label(row) : a3.label;
        return b2`
            <ion-button
              size="small"
              fill="clear"
              color=${a3.color ?? "medium"}
              data-testid=${this.tid(`row-${key}-${a3.id}`)}
              ?disabled=${disabled}
              aria-disabled=${disabled ? "true" : A}
              aria-label=${label}
              title=${label}
              @click=${() => this.emit("rowAction", { actionId: a3.id, row })}
            >
              ${loading ? b2`<ion-spinner slot="icon-only" name="dots"></ion-spinner>` : a3.icon ? b2`<ion-icon slot="icon-only" .icon=${okIcon(a3.icon)}></ion-icon>` : label}
            </ion-button>
          `;
      }
    )}
      </div>
    `;
  }
  // Botón de barra icon-only (filtros / alta / conmutador de vista). `on` = estado activo.
  // `badge` opcional → contador (p.ej. nº de filtros activos), look del Hub.
  toolButton(icon, on, onClick, label, badge, testid = A) {
    return b2`
      <ion-button class="toolbtn" size="small" fill=${on ? "solid" : "outline"} data-testid=${testid} title=${label} aria-label=${label} @click=${onClick}>
        <ion-icon slot="icon-only" .icon=${okIcon(icon)}></ion-icon>
        ${badge && badge > 0 ? b2`<span class="badge">${badge}</span>` : A}
      </ion-button>
    `;
  }
  /** Plantilla de columnas del grid de la vista lista: [checkbox] [columnas…] [acciones]. */
  gridTemplate() {
    return [
      this.selectable ? "2.75rem" : null,
      // #120 - 5.5rem (88px) is the narrowest a data column can be and stay readable: ~11
      // characters at 14px, plus the ellipsis `.gcell > span` already applies. With the previous
      // floor (8rem = 128px) the six columns of a bookings list did not fit the counter tablet
      // (128x6 + 188 for actions + gaps = 1036px against 834) and the pinned column ended up on
      // top of the data. With 5.5rem they fit (796px) and `1fr` stretches them to 94px each.
      ...this.visibleColumns.map((c5) => c5.width ?? "minmax(5.5rem,1fr)"),
      // #121 - a LENGTH, not `max-content`. The header and every row are separate grids that
      // share this string, and a content-sized track is not a length: each grid resolves it
      // against ITS OWN content - the word "ACCIONES" (62.83px) in the header, four buttons
      // (188px) in the row. The leftover the `1fr` columns share then differed between the two,
      // and the header slid right, up to 125px by the last column (measured at 834px).
      // `actionsTrackPx` is the width of the buttons MEASURED on screen, so it also keeps #120's
      // contract: the track never shrinks under its content (an `auto` track collapsed to 16px
      // and the buttons spilled over the neighbouring column). Until the first measurement lands
      // - one frame - `max-content` reserves the same room it always did.
      this.actions.length ? this.actionsTrackPx > 0 ? `${this.actionsTrackPx}px` : "max-content" : null
    ].filter(Boolean).join(" ");
  }
  /** Lista de páginas a mostrar en el pager numerado (1-based): primera, última, vecinas de la
   *  actual y «…» donde haya saltos. P.ej. en página 1 de 52 → [1,2,3,'…',52]. */
  pageList(cur1, total) {
    if (total <= 7) return Array.from({ length: total }, (_2, i7) => i7 + 1);
    const want = /* @__PURE__ */ new Set([1, total, cur1, cur1 - 1, cur1 + 1]);
    if (cur1 <= 3) [2, 3].forEach((p4) => want.add(p4));
    if (cur1 >= total - 2) [total - 1, total - 2].forEach((p4) => want.add(p4));
    const sorted = [...want].filter((p4) => p4 >= 1 && p4 <= total).sort((a3, b3) => a3 - b3);
    const out = [];
    let prev = 0;
    for (const p4 of sorted) {
      if (p4 - prev > 1) out.push("\u2026");
      out.push(p4);
      prev = p4;
    }
    return out;
  }
  render() {
    const ps = this.serverSide ? this.pageSize : this.clientPageSize || this.pageSize;
    let visible;
    let pages;
    let current;
    let count;
    if (this.serverSide) {
      visible = this.rows;
      count = this.total;
      pages = Math.max(1, Math.ceil(this.total / ps));
      current = Math.min(this.page, pages - 1);
    } else {
      const filtered = this.clientFiltered;
      count = filtered.length;
      pages = Math.max(1, Math.ceil(filtered.length / ps));
      current = Math.min(this.clientPage, pages - 1);
      visible = this.isMobile ? filtered.slice(0, Math.min(this.mobileShown || ps, count)) : filtered.slice(current * ps, current * ps + ps);
    }
    const served = this.serverSide ? (current + 1) * ps : Math.min(this.mobileShown || ps, count);
    const canLoadMore = this.isMobile && served < count;
    const loadMore = () => {
      if (this.serverSide) this.emit("pageChange", current + 1);
      else this.mobileShown = Math.min((this.mobileShown || ps) + ps, count);
    };
    const goTo = (p4) => {
      if (this.serverSide) this.emit("pageChange", p4);
      else this.clientPage = p4;
    };
    const setPageSize = (n6) => {
      if (this.serverSide) this.emit("pageSizeChange", n6);
      else {
        this.clientPageSize = n6;
        this.clientPage = 0;
        this.mobileShown = 0;
      }
    };
    const searchbar = b2`<ion-searchbar class="ion-no-border" data-testid=${this.tid("search")} .value=${this.q} placeholder=${this.effSearchPlaceholder} debounce="250" @ionInput=${this.onSearch}></ion-searchbar>`;
    const selCount = this.selection.size;
    const showTopbar = !!this.title || this.hasSearch || this.viewToggle || this.effColumnPicker || this.effExport || this.effImport || this.hasFilterRow || this.addable || !!this.primaryAction;
    return b2`
      <div class=${`card${this.panel !== "none" ? " has-panel" : ""}`}>
        ${showTopbar ? b2`
              <div class="bar">
                <div class="bar-main">
                  ${this.title ? b2`<div class="title-wrap"><h2 class="title">${this.title}</h2><span class="title-count">${count}</span></div>` : A}
                  ${this.hasSearch ? b2`<div class="search">${searchbar}</div>` : A}
                  ${this.inlineFilters ? this.renderInlineFilters() : A}
                  <span class="tk-spacer"></span>
                    ${this.effColumnPicker && !this.isMobile ? b2`
                          <ion-select
                            class="tk-cols"
                            multiple
                            interface="popover"
                            aria-label=${this.t.columnsVisible}
                            .value=${this.visibleColumns.map((c5) => c5.key)}
                            .selectedText=${this.t.columns}
                            @ionChange=${(e5) => this.setVisibleColumns(e5.detail.value)}
                          >
                            ${this.columns.map((c5) => b2`<ion-select-option value=${c5.key}>${c5.header}</ion-select-option>`)}
                          </ion-select>
                        ` : A}
                    ${this.effPageSizes.length && !this.isMobile ? b2`
                          <ion-select
                            class="tk-psize"
                            interface="popover"
                            aria-label=${this.t.rowsPerPage}
                            .value=${ps}
                            @ionChange=${(e5) => setPageSize(Number(e5.detail.value))}
                          >
                            ${this.effPageSizes.map((n6) => b2`<ion-select-option .value=${n6}>${n6}</ion-select-option>`)}
                          </ion-select>
                        ` : A}
                    ${this.viewToggle ? b2`
                          <span class="viewseg">
                            ${this.toolButton("list-outline", this.viewMode === "table", () => this.setViewMode("table"), this.t.viewList)}
                            ${this.toolButton("grid-outline", this.viewMode === "cards", () => this.setViewMode("cards"), this.t.viewCards)}
                          </span>
                        ` : A}
                    ${this.hasFilterRow && !this.inlineFilters ? this.toolButton("funnel-outline", this.panel === "filters" || this.activeFilterCount > 0, () => this.toggle("filters"), this.t.filters, this.activeFilterCount) : A}
                    ${this.effImport ? b2`
                          ${this.toolButton("cloud-upload-outline", false, () => this.renderRoot.querySelector(".tk-file")?.click(), this.t.importCsv)}
                          <!-- #143 — The import hook goes on the INPUT, not on the button that
                               triggers it: what a spec drives is «setInputFiles», and nobody opens
                               the button's native dialog from a test. Same criterion as
                               «GrantFilePicker.vue» in the Hub (the hook goes on the control, not
                               on its disguise). -->
                          <input class="tk-file" data-testid=${this.tid("csv-import")} type="file" accept=".csv,text/csv" hidden @change=${(e5) => this.onImportFile(e5)} />
                        ` : A}
                    ${this.effExport ? this.toolButton("download-outline", false, () => this.exportCsv(), this.t.exportCsv, void 0, this.tid("csv-export")) : A}
                    <!-- #113 — Mismo botón en los dos viewports: la acción principal de la pantalla
                         se lee, no se adivina. En escritorio era un «+» de 36px idéntico a los
                         iconos de vista/filtrar/exportar, y era el último de cuatro. -->
                    ${this.addable ? b2`
                          <ion-button class="primary-btn add-btn" data-testid=${this.tid("add")} size="small" @click=${() => this.toggle("create")}>
                            <ion-icon slot="start" .icon=${okIcon("add")}></ion-icon>${this.t.add}
                          </ion-button>
                        ` : A}
                    ${this.renderOverflowMenu()}
                    ${this.primaryAction ? b2`
                          <!-- #143 — Its own hook and NOT «-add»: «addable» and «primaryAction» are
                               two different buttons that may coexist, and both are really used
                               («addable» in the modules, «primaryAction» in the SaaS screens).
                               Sharing the name would give two elements with the same hook as soon
                               as a screen declared both. -->
                          <ion-button class="primary-btn add-btn" data-testid=${this.tid("primary-action")} size="small" @click=${() => this.emit("primaryAction", {})}>
                            <ion-icon slot="start" .icon=${okIcon(this.primaryAction.icon ?? "add")}></ion-icon>${this.primaryAction.label}
                          </ion-button>
                        ` : A}
                    <!-- El módulo proyecta aquí acciones globales adicionales. -->
                    <slot name="toolbar"></slot>
                </div>
                ${this.selectable && selCount > 0 ? b2`
                      <div class="selbar">
                        <strong>${this.t.selected.replace("{n}", String(selCount))}</strong>
                        <button class="sel-clear" @click=${() => this.setSelection(/* @__PURE__ */ new Set())}>
                          <ion-icon .icon=${iconClose} style="font-size:14px"></ion-icon> ${this.t.clear}
                        </button>
                      </div>
                    ` : A}
              </div>
            ` : A}

        ${this.viewMode === "cards" && this.cardViewEnabled ? this.renderCards(visible) : this.renderTable(visible)}

        ${pages > 1 || this.effPageSizes.length ? b2`
              <div class="pager">
                <div class="left">
                  <span>
                    ${pages > 1 ? b2`${this.t.showing.replace("{from}", String(this.isMobile && !this.serverSide ? 1 : current * ps + 1)).replace("{to}", String(Math.min(served, count)))} ` : A}
                    <span class="strong">${count}</span> ${count === 1 ? this.t.recordSingular : this.t.recordPlural}
                  </span>
                  ${!showTopbar && this.effPageSizes.length ? b2`
                        <select class="psize" @change=${(e5) => setPageSize(Number(e5.target.value))}>
                          ${this.effPageSizes.map((n6) => b2`<option value=${n6} ?selected=${n6 === ps}>${this.t.perPageShort.replace("{n}", String(n6))}</option>`)}
                        </select>
                      ` : A}
                </div>
                ${this.isMobile ? canLoadMore ? b2`<ion-button class="load-more" data-testid=${this.tid("load-more")} size="small" @click=${loadMore}>${this.t.loadMore}</ion-button>` : A : pages > 1 ? b2`
                      <div class="nav">
                        <ion-button size="small" fill="clear" data-testid=${this.tid("page-prev")} ?disabled=${current === 0} @click=${() => goTo(current - 1)}><ion-icon slot="icon-only" .icon=${iconChevronBack}></ion-icon></ion-button>
                        ${this.pageList(current + 1, pages).map(
      (p4) => p4 === "\u2026" ? b2`<span class="pgap">…</span>` : b2`<button class=${`pnum${p4 === current + 1 ? " on" : ""}`} @click=${() => goTo(p4 - 1)}>${p4}</button>`
    )}
                        <ion-button size="small" fill="clear" data-testid=${this.tid("page-next")} ?disabled=${current >= pages - 1} @click=${() => goTo(current + 1)}><ion-icon slot="icon-only" .icon=${iconChevronForward}></ion-icon></ion-button>
                      </div>
                    ` : A}
              </div>
            ` : A}

        ${this.panel !== "none" ? this.renderDrawer() : A}
      </div>
    `;
  }
  // Panel lateral derecho DENTRO de la tabla (no empuja contenido; igual en lista y tarjetas).
  renderDrawer() {
    const isFilters = this.panel === "filters";
    const clientFilters = isFilters && !this.serverSide;
    return b2`
      <div class="tk-scrim" @click=${() => this.close()}></div>
      <aside class="drawer" role="dialog" aria-label=${isFilters ? this.t.filters : this.t.form}>
        <header class="dh">
          <strong>${isFilters ? this.t.filters : this.t.newRecord}</strong>
          <ion-button fill="clear" size="small" aria-label=${this.t.close} @click=${() => this.close()}><ion-icon slot="icon-only" .icon=${iconClose}></ion-icon></ion-button>
        </header>
        <div class="db">
          ${isFilters ? clientFilters ? this.filterColumns.map((c5) => this.renderClientFilter(c5)) : this.filterColumns.map((c5) => b2`<div class="fblock">${this.renderFilterControl(c5)}</div>`) : b2`<slot name="create"></slot>`}
        </div>
        ${clientFilters ? b2`
              <footer class="df">
                <button class="sel-clear df-clear" ?disabled=${Object.keys(this.filterDraft).length === 0} @click=${() => this.clearFilters()}>${this.t.clear}</button>
                <ion-button class="primary-btn" size="small" @click=${() => this.applyFilters()}>${this.t.apply}</ion-button>
              </footer>
            ` : A}
      </aside>
    `;
  }
  // Control de filtro CLIENTE de una columna: chips multi-select (select) o rango de fechas.
  renderClientFilter(col) {
    const label = col.header;
    if (col.filterType === "daterange" || col.filterType === "date") {
      const f3 = this.filterDraft[col.key] ?? {};
      return b2`
        <div class="fblock">
          <span class="flabel">${label}</span>
          <div class="daterange">
            <ion-input type="date" label=${this.t.from} label-placement="stacked" fill="outline" mode="md" .value=${f3.from ?? ""} @ionChange=${(e5) => this.setFilterRange(col.key, "from", e5.detail.value ?? "")}></ion-input>
            <ion-input type="date" label=${this.t.to} label-placement="stacked" fill="outline" mode="md" .value=${f3.to ?? ""} @ionChange=${(e5) => this.setFilterRange(col.key, "to", e5.detail.value ?? "")}></ion-input>
          </div>
        </div>
      `;
    }
    const opts = col.options ?? this.distinctValues(col).map((v3) => ({ value: v3, label: v3 }));
    const selected = [...this.filterDraft[col.key]?.values ?? /* @__PURE__ */ new Set()];
    return b2`
      <div class="fblock">
        <ion-select
          label=${label}
          label-placement="stacked"
          fill="outline" mode="md"
          multiple
          interface="modal"
          .interfaceOptions=${{ cssClass: "ok-overlay" }}
          placeholder=${this.t.select}
          .value=${selected}
          @ionChange=${(e5) => this.setFilterValues(col.key, e5.detail.value ?? [])}
        >
          ${opts.length === 0 ? b2`<ion-select-option .disabled=${true} value="">${this.t.noValues}</ion-select-option>` : opts.map((o7) => b2`<ion-select-option value=${o7.value}>${o7.label}</ion-select-option>`)}
        </ion-select>
      </div>
    `;
  }
  /** #67 — Enter/Espacio activan la fila clicable (y, desde #74, la tarjeta): si se llega con el
   *  tabulador, el ratón no puede ser el único camino. Espacio además NO debe desplazar la página. */
  onRowKeydown(e5, row) {
    if (e5.key !== "Enter" && e5.key !== " " && e5.key !== "Spacebar") return;
    e5.preventDefault();
    this.emit("rowClick", { row });
  }
  emptyState() {
    return b2`
      <div class="empty">
        <span class="empty-ic"><ion-icon .icon=${iconFileTrayOutline}></ion-icon></span>
        <span>${this.effEmptyMessage}</span>
      </div>
    `;
  }
  // Vista LISTA en CSS GRID (no <table>): permite ancho por columna y cabecera sticky.
  renderTable(visible) {
    if (visible.length === 0) return this.emptyState();
    const cols = this.visibleColumns;
    const tpl = { gridTemplateColumns: this.gridTemplate() };
    const allOn = this.selectable && visible.length > 0 && visible.every((r6) => this.selection.has(this.keyOf(r6)));
    const alignCls = (a3) => a3 === "right" ? "right" : a3 === "center" ? "center" : "left";
    return b2`
      <div class=${`scroll${this.xOverflow ? " x-overflow" : ""}`}>
        <div class="grid" role="table">
          <!-- Cabecera -->
          <div class="grow ghead" role="row" style=${o6(tpl)}>
            ${this.selectable ? b2`<span class="selcb"><ion-checkbox .checked=${allOn} aria-label=${this.t.selectAll} @ionChange=${() => this.toggleAll(visible)}></ion-checkbox></span>` : A}
            ${cols.map((c5) => {
      const sortable = this.isSortable(c5);
      const active = sortable && (this.serverSide ? this.sort === c5.key : this.clientSort === c5.key);
      const dir = this.serverSide ? this.sortDir : this.clientSortDir;
      const caretIcon = !active ? iconSwapVerticalOutline : dir === "asc" ? iconChevronUpOutline : iconChevronDownOutline;
      return b2`
                <div
                  class=${`gcell gh ${alignCls(c5.align)}${sortable ? " sortable" : ""}${c5.pinned === "end" ? " actions-col" : ""}`}
                  role="columnheader"
                  @click=${() => this.onHeaderClick(c5)}
                >
                  <span>${c5.header}</span>
                  ${sortable ? b2`<span class=${`caret${active ? " on" : ""}`}><ion-icon .icon=${okIcon(caretIcon)}></ion-icon></span>` : A}
                </div>
              `;
    })}
            ${this.actions.length ? b2`<div class="gcell gh right actions-col" role="columnheader">
                  ${this.rowActionsCollapsed ? b2`<span class="sr-only">${this.t.actions}</span>` : b2`<span>${this.t.actions}</span>`}
                </div>` : A}
          </div>

          <!-- Filas -->
          ${c4(
      visible,
      (row) => this.keyOf(row),
      (row) => {
        const key = this.keyOf(row);
        const selected = this.selectable && this.selection.has(key);
        return b2`
                <div
                  class=${`grow grow-data${selected ? " selected" : ""}${this.rowClickable ? " clickable" : ""}`}
                  role="row"
                  data-testid=${this.tid(`row-${key}`)}
                  style=${o6(tpl)}
                  tabindex=${this.rowClickable ? "0" : A}
                  @click=${this.rowClickable ? () => this.emit("rowClick", { row }) : A}
                  @keydown=${this.rowClickable ? (e5) => this.onRowKeydown(e5, row) : A}
                >
                  ${this.selectable ? b2`<span class="selcb" @click=${(e5) => e5.stopPropagation()}><ion-checkbox .checked=${selected} aria-label=${this.t.selectRow} @ionChange=${() => this.toggleRow(key)}></ion-checkbox></span>` : A}
                  ${cols.map(
          (c5) => b2`<div class=${`gcell ${alignCls(c5.align)}${c5.pinned === "end" ? " actions-col" : ""}`} role="cell">${c5.render ? c5.render(row) : b2`<span>${this.cell(c5, row)}</span>`}</div>`
        )}
                  ${this.actions.length ? b2`<div class="gcell right actions-col" role="cell" @click=${(e5) => e5.stopPropagation()}>${this.actionButtons(row, true)}</div>` : A}
                </div>
              `;
      }
    )}
        </div>
      </div>
      ${this.renderRowMenu()}
    `;
  }
  renderCards(visible) {
    if (visible.length === 0) return this.emptyState();
    const hasHead = !!this.cardTitle || !!this.cardIcon || this.selectable;
    return b2`
      <div class="cards-grid">
        ${c4(
      visible,
      (row) => this.keyOf(row),
      (row) => {
        const key = this.keyOf(row);
        const selected = this.selectable && this.selection.has(key);
        const icon = this.cardIcon?.(row);
        return b2`
              <ion-card
                class=${`rcard${selected ? " selected" : ""}${this.rowClickable ? " clickable" : ""}`}
                data-testid=${this.tid(`row-${key}`)}
                role=${this.rowClickable ? "button" : A}
                tabindex=${this.rowClickable ? "0" : A}
                @click=${this.rowClickable ? () => this.emit("rowClick", { row }) : A}
                @keydown=${this.rowClickable ? (e5) => this.onRowKeydown(e5, row) : A}
              >
                ${hasHead ? b2`
                      <ion-card-header class="rcard-head">
                        ${icon != null && icon !== "" ? b2`<span class="rc-icon">${typeof icon === "string" ? b2`<ion-icon .icon=${okIcon(icon)}></ion-icon>` : icon}</span>` : A}
                        <span class="rc-title">${this.cardTitle ? this.cardTitle(row) : A}</span>
                        ${this.selectable ? b2`<ion-checkbox .checked=${selected} aria-label=${this.t.select} @click=${(e5) => e5.stopPropagation()} @ionChange=${() => this.toggleRow(key)}></ion-checkbox>` : A}
                      </ion-card-header>
                    ` : A}
                <ion-card-content class="rcard-body">
                  ${this.renderCard ? this.renderCard(row) : this.visibleColumns.map(
          (c5) => b2`<div class="rrow"><span class="rk">${c5.header}</span><span class="rv">${c5.render ? c5.render(row) : this.cell(c5, row)}</span></div>`
        )}
                </ion-card-content>
                ${this.actions.length ? b2`<div class="ractions" @click=${(e5) => e5.stopPropagation()}>${this.actionButtons(row)}</div>` : A}
              </ion-card>
            `;
      }
    )}
      </div>
    `;
  }
};
__decorateClass4([
  n4({ attribute: false })
], _OkDataTable.prototype, "columns");
__decorateClass4([
  n4({ attribute: false })
], _OkDataTable.prototype, "rows");
__decorateClass4([
  n4({ attribute: false })
], _OkDataTable.prototype, "searchKeys");
__decorateClass4([
  n4({ attribute: "row-key-field" })
], _OkDataTable.prototype, "rowKeyField");
__decorateClass4([
  n4({ attribute: false })
], _OkDataTable.prototype, "rowKey");
__decorateClass4([
  n4({ type: Number, attribute: "page-size" })
], _OkDataTable.prototype, "pageSize");
__decorateClass4([
  n4({ attribute: "empty-message" })
], _OkDataTable.prototype, "emptyMessage");
__decorateClass4([
  n4({ attribute: "search-placeholder" })
], _OkDataTable.prototype, "searchPlaceholder");
__decorateClass4([
  n4({ attribute: false })
], _OkDataTable.prototype, "labels");
__decorateClass4([
  n4({ attribute: false })
], _OkDataTable.prototype, "actions");
__decorateClass4([
  n4({ type: Boolean })
], _OkDataTable.prototype, "addable");
__decorateClass4([
  n4({ attribute: false })
], _OkDataTable.prototype, "pageSizeOptions");
__decorateClass4([
  n4({ type: Boolean, reflect: true })
], _OkDataTable.prototype, "fill");
__decorateClass4([
  n4({ type: Boolean, attribute: "column-picker" })
], _OkDataTable.prototype, "columnPicker");
__decorateClass4([
  n4({ type: Boolean })
], _OkDataTable.prototype, "csv");
__decorateClass4([
  n4({ attribute: "csv-name" })
], _OkDataTable.prototype, "csvName");
__decorateClass4([
  n4({ type: Boolean, attribute: "server-side" })
], _OkDataTable.prototype, "serverSide");
__decorateClass4([
  n4({ type: Number })
], _OkDataTable.prototype, "total");
__decorateClass4([
  n4({ type: Number })
], _OkDataTable.prototype, "page");
__decorateClass4([
  n4({ type: Boolean })
], _OkDataTable.prototype, "searchable");
__decorateClass4([
  n4({ type: String })
], _OkDataTable.prototype, "search");
__decorateClass4([
  n4({ type: String })
], _OkDataTable.prototype, "sort");
__decorateClass4([
  n4({ attribute: "sort-dir" })
], _OkDataTable.prototype, "sortDir");
__decorateClass4([
  n4({ attribute: false })
], _OkDataTable.prototype, "filterValues");
__decorateClass4([
  n4()
], _OkDataTable.prototype, "title");
__decorateClass4([
  n4({ attribute: false })
], _OkDataTable.prototype, "views");
__decorateClass4([
  n4({ attribute: "default-view" })
], _OkDataTable.prototype, "defaultView");
__decorateClass4([
  n4({ type: Boolean })
], _OkDataTable.prototype, "exportable");
__decorateClass4([
  n4({ type: Boolean })
], _OkDataTable.prototype, "importable");
__decorateClass4([
  n4({ type: Boolean, attribute: "column-selector" })
], _OkDataTable.prototype, "columnSelector");
__decorateClass4([
  n4({ attribute: false })
], _OkDataTable.prototype, "pageSizes");
__decorateClass4([
  n4({ type: Boolean, attribute: "row-clickable" })
], _OkDataTable.prototype, "rowClickable");
__decorateClass4([
  n4({ type: Boolean })
], _OkDataTable.prototype, "selectable");
__decorateClass4([
  n4({ attribute: false })
], _OkDataTable.prototype, "selectedKeys");
__decorateClass4([
  n4({ attribute: false })
], _OkDataTable.prototype, "primaryAction");
__decorateClass4([
  n4({ type: Boolean })
], _OkDataTable.prototype, "inlineFilters");
__decorateClass4([
  n4({ attribute: false })
], _OkDataTable.prototype, "menuActions");
__decorateClass4([
  n4({ attribute: false })
], _OkDataTable.prototype, "cardTitle");
__decorateClass4([
  n4({ attribute: false })
], _OkDataTable.prototype, "cardIcon");
__decorateClass4([
  n4({ attribute: false })
], _OkDataTable.prototype, "renderCard");
__decorateClass4([
  n4({ type: String })
], _OkDataTable.prototype, "testid");
__decorateClass4([
  r5()
], _OkDataTable.prototype, "q");
__decorateClass4([
  r5()
], _OkDataTable.prototype, "clientPage");
__decorateClass4([
  r5()
], _OkDataTable.prototype, "clientPageSize");
__decorateClass4([
  r5()
], _OkDataTable.prototype, "mobileShown");
__decorateClass4([
  r5()
], _OkDataTable.prototype, "clientSort");
__decorateClass4([
  r5()
], _OkDataTable.prototype, "clientSortDir");
__decorateClass4([
  r5()
], _OkDataTable.prototype, "clientFilters");
__decorateClass4([
  r5()
], _OkDataTable.prototype, "filterDraft");
__decorateClass4([
  r5()
], _OkDataTable.prototype, "serverFilters");
__decorateClass4([
  r5()
], _OkDataTable.prototype, "panel");
__decorateClass4([
  r5()
], _OkDataTable.prototype, "viewMode");
__decorateClass4([
  r5()
], _OkDataTable.prototype, "isMobile");
__decorateClass4([
  r5()
], _OkDataTable.prototype, "xOverflow");
__decorateClass4([
  r5()
], _OkDataTable.prototype, "actionsTrackPx");
__decorateClass4([
  r5()
], _OkDataTable.prototype, "rowActionsCollapsed");
__decorateClass4([
  r5()
], _OkDataTable.prototype, "rowMenuOpen");
__decorateClass4([
  r5()
], _OkDataTable.prototype, "hiddenKeys");
__decorateClass4([
  r5()
], _OkDataTable.prototype, "internalSelection");
__decorateClass4([
  r5()
], _OkDataTable.prototype, "menuOpen");
var OkDataTable = _OkDataTable;
define("ok-data-table", OkDataTable);

// @erplora/outfitkit/dist/ok-scheduler.js
var __defProp5 = Object.defineProperty;
var __decorateClass5 = (decorators, target, key, kind) => {
  var result = void 0;
  for (var i7 = decorators.length - 1, decorator; i7 >= 0; i7--)
    if (decorator = decorators[i7])
      result = decorator(target, key, result) || result;
  if (result) __defProp5(target, key, result);
  return result;
};
var DEFAULT_LABELS3 = {
  prevDay: "Previous day",
  nextDay: "Next day",
  empty: "No resources to display."
};
var DRAG_THRESHOLD_PX = 5;
var TOUCH_HOLD_MS = 400;
var TOUCH_HOLD_TOLERANCE_PX = 10;
var STACK_GAP_PX = 2;
var OkScheduler = class extends i3 {
  constructor() {
    super(...arguments);
    this.resources = [];
    this.events = [];
    this.date = "";
    this.startHour = 8;
    this.endHour = 20;
    this.slotMin = 60;
    this.locale = "en-US";
    this.labels = {};
    this.movable = false;
    this.resizable = false;
    this.snapMin = 15;
    this.cursor = /* @__PURE__ */ new Date();
    this.seeded = false;
    this.drag = null;
    this.pending = null;
    this.announcement = "";
    this.heldId = null;
    this.pointerDrag = null;
    this.suppressClick = false;
    this.suppressClickTimer = null;
    this.blockScrollWhileDragging = (e5) => {
      if (this.pointerDrag?.held) e5.preventDefault();
    };
  }
  static {
    this.styles = i`
    :host {
      /* Vars overridable (estilo Ionic), default = cadena --ok-* → --ion-* → hex */
      --color: var(--ok-text, var(--ion-text-color, #1c1b17));
      --color-muted: var(--ok-text-muted, rgba(var(--ion-text-color-rgb, 28, 27, 23), 0.55));
      --background: var(--ok-surface, var(--ion-background-color, #ffffff));
      --primary-color: var(--ok-primary, var(--ion-color-primary, #3880ff));
      --primary-contrast: var(--ok-primary-contrast, var(--ion-color-primary-contrast, #ffffff));
      --hover-bg: var(--ok-hover, rgba(var(--ion-text-color-rgb, 28, 27, 23), 0.06));
      --border-color: var(--ok-border-soft, rgba(var(--ion-text-color-rgb, 28, 27, 23), 0.12));
      --border-radius: var(--ok-radius, 8px);
      --resource-width: var(--ok-scheduler-resource-width, 11rem);
      --hour-width: var(--ok-scheduler-hour-width, 6rem);
      --row-height: var(--ok-scheduler-row-height, 3.5rem);
      /* Alto mínimo de un sub-carril de solape. NO hay tope de citas simultáneas: se reparte
         mientras cada bloque quepa en una línea legible y, por debajo de eso, la FILA CRECE. Es el
         minPackSize de Bryntum y el default de Mobiscroll en timeline horizontal — el parámetro
         correcto es el alto, no un número: una cita de 15 min partida en tres es ilegible aunque
         «tres» suene poco. */
      --min-stack-height: var(--ok-scheduler-min-stack-height, 1.6rem);
      --font: var(--ok-font, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);

      /* Por defecto ocupa el ancho del contenedor y es responsive. */
      display: block;
      width: 100%;
      color: var(--color);
      font-family: var(--font);
      font-size: 0.95rem;
      box-sizing: border-box;
    }
    * {
      box-sizing: border-box;
    }

    /* ── Cabecera de navegación de día ──────────────────────────── */
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.25rem;
      margin-bottom: 0.6rem;
    }
    .toolbar .title {
      min-width: 12rem;
      text-align: center;
      font-weight: 600;
      font-size: 1.05rem;
      text-transform: capitalize;
    }

    /* ── Contenedor con scroll horizontal ───────────────────────── */
    .scroll {
      width: 100%;
      overflow-x: auto;
      overflow-y: hidden;
      border: 1px solid var(--border-color);
      border-radius: var(--border-radius);
      -webkit-overflow-scrolling: touch;
    }
    /* El grid interior tiene ancho intrínseco = columna recurso + franja horaria. */
    .grid {
      display: inline-block;
      min-width: 100%;
    }

    /* ── Cabecera horaria ───────────────────────────────────────── */
    .head-row {
      display: flex;
      position: sticky;
      top: 0;
      z-index: 3;
    }
    .corner {
      flex: 0 0 var(--resource-width);
      width: var(--resource-width);
      position: sticky;
      left: 0;
      z-index: 4;
      background: var(--background);
      border-right: 1px solid var(--border-color);
      border-bottom: 1px solid var(--border-color);
    }
    .timeline {
      display: flex;
      flex: 1 1 auto;
    }
    .hour {
      flex: 0 0 var(--hour-width);
      width: var(--hour-width);
      padding: 0.4rem 0.5rem;
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--color-muted);
      text-align: left;
      background: var(--background);
      border-bottom: 1px solid var(--border-color);
      border-right: 1px solid var(--border-color);
      font-variant-numeric: tabular-nums;
    }
    .hour:last-child {
      border-right: 0;
    }

    /* ── Filas de recurso ───────────────────────────────────────── */
    .row {
      display: flex;
      border-top: 1px solid var(--border-color);
    }
    .row:first-of-type {
      border-top: 0;
    }
    .resource {
      flex: 0 0 var(--resource-width);
      width: var(--resource-width);
      min-height: var(--row-height);
      position: sticky;
      left: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.6rem;
      background: var(--background);
      border-right: 1px solid var(--border-color);
    }
    .avatar {
      flex: 0 0 auto;
      width: 2rem;
      height: 2rem;
      border-radius: 999px;
      object-fit: cover;
      background: var(--hover-bg);
    }
    .avatar-fallback {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2rem;
      height: 2rem;
      border-radius: 999px;
      background: var(--hover-bg);
      color: var(--color-muted);
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .resource-label {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 500;
    }

    /* ── Pista de eventos (lane) de un recurso ──────────────────── */
    .lane {
      position: relative;
      flex: 1 1 auto;
      /* Con un solo ocupante la fila es la de siempre. En cuanto los sub-carriles no caben con su
         alto mínimo, la fila CRECE en vez de adelgazar los bloques: aquí el timeline es horizontal,
         así que el alto de la fila es un recurso ABIERTO —crecer una fila no le quita nada a las
         demás— al revés que el ancho de columna de una agenda de día vertical. */
      min-height: max(var(--row-height), calc(var(--stacks, 1) * var(--min-stack-height)));
      background: var(--background);
    }
    /* Celdas-slot clicables de fondo (para crear turnos). */
    .slot {
      position: absolute;
      top: 0;
      bottom: 0;
      border-right: 1px solid var(--border-color);
      cursor: pointer;
      transition: background-color var(--ok-transition, 150ms ease),
        color var(--ok-transition, 150ms ease), border-color var(--ok-transition, 150ms ease),
        box-shadow var(--ok-transition, 150ms ease), transform 120ms ease;
    }
    @media (hover: hover) {
      .slot:hover {
        background: var(--hover-bg);
      }
    }
    .slot:active {
      transform: scale(var(--ok-press-scale, 0.97));
    }
    .slot:last-child {
      border-right: 0;
    }

    /* ── Bloque de evento ───────────────────────────────────────── */
    .event {
      position: absolute;
      top: 0.25rem;
      bottom: 0.25rem;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 0.2rem 0.45rem;
      border-radius: 6px;
      color: var(--primary-contrast);
      cursor: pointer;
      overflow: hidden;
      z-index: 1;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
      transition: background-color var(--ok-transition, 150ms ease),
        color var(--ok-transition, 150ms ease), border-color var(--ok-transition, 150ms ease),
        box-shadow var(--ok-transition, 150ms ease), transform 120ms ease, filter 0.12s ease;
    }
    @media (hover: hover) {
      .event:hover {
        filter: brightness(1.05);
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.22);
      }
    }
    .event:active {
      transform: scale(var(--ok-press-scale, 0.97));
    }
    /* Solo cuando el host activa movable: el bloque es una superficie de arrastre.
       NO se pone touch-action:none — el dedo tiene que poder hacer scroll de la rejilla desde
       encima del bloque. El arrastre táctil se arma con la pulsación mantenida y a partir de ahí
       el scroll se corta a mano (preventDefault del touchmove). */
    .event.movable {
      cursor: grab;
    }
    /* Pulsación mantenida completada: el bloque "se levanta" y avisa de que ya está cogido. */
    .event.held {
      transform: scale(1.03);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
    .event.dragging {
      cursor: grabbing;
      z-index: 5;
      opacity: 0.92;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.32);
      /* Deja pasar el hit-test al carril de debajo para saber sobre qué recurso está. */
      pointer-events: none;
      transition: none;
    }
    .event.resizing {
      z-index: 5;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.32);
      transition: none;
    }
    .event:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }
    /* Asa del borde de FIN. Una franja estrecha con su propio cursor, para que se vea que ahí el
       gesto es otro. En puntero grueso (dedo) se ensancha: 0.85 rem son ~14 px, y un dedo no
       acierta en 14 px. No se llega a 44 px a propósito — el asa se come el bloque entero en una
       cita de 15 min y ya no se podría ni mover ni abrir. */
    .resize-handle {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: var(--resize-handle-width, 0.85rem);
      cursor: col-resize;
      border-top-right-radius: 6px;
      border-bottom-right-radius: 6px;
      background: linear-gradient(to right, transparent, rgba(0, 0, 0, 0.22));
      touch-action: none;
    }
    /* La marquita del centro: sin ella el asa es invisible y nadie sabe que se puede arrastrar. */
    .resize-handle::after {
      content: '';
      position: absolute;
      top: 50%;
      right: 0.28rem;
      width: 2px;
      height: 0.9rem;
      transform: translateY(-50%);
      border-radius: 1px;
      background: var(--primary-contrast);
      opacity: 0.75;
    }
    @media (pointer: coarse) {
      .resize-handle {
        width: var(--resize-handle-width, 1.35rem);
      }
    }
    /* Hueco de origen: dice de dónde salió el bloque mientras está en el aire. */
    .ghost {
      position: absolute;
      top: 0.25rem;
      bottom: 0.25rem;
      border-radius: 6px;
      border: 2px dashed var(--border-color);
      background: var(--hover-bg);
      pointer-events: none;
      z-index: 0;
    }
    /* Anuncio para lector de pantalla del movimiento por teclado. */
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
      border: 0;
    }
    .event-title {
      font-size: 0.78rem;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .event-time {
      font-size: 0.68rem;
      opacity: 0.9;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }

    /* ── Estado vacío ───────────────────────────────────────────── */
    .empty {
      padding: 1.5rem;
      text-align: center;
      color: var(--color-muted);
    }

    @media (prefers-reduced-motion: reduce) {
      .slot:active,
      .event:active,
      .event.held {
        transform: none;
      }
    }

    /* ── Responsive (móvil): franja más estrecha, recurso visible ── */
    @media (max-width: 540px) {
      :host {
        --resource-width: 7rem;
        --hour-width: 3.5rem;
      }
      .hour {
        font-size: 0.7rem;
        padding: 0.35rem 0.3rem;
      }
      .avatar,
      .avatar-fallback {
        width: 1.6rem;
        height: 1.6rem;
        font-size: 0.7rem;
      }
      .event-time {
        display: none;
      }
    }
  `;
  }
  /** Textos efectivos: defaults INGLÉS mezclados con los del consumidor. */
  get t() {
    return { ...DEFAULT_LABELS3, ...this.labels };
  }
  // El refresco del host manda: descarta la posición optimista en cuanto llegan eventos nuevos.
  willUpdate(changed) {
    if (changed.has("events")) this.pending = null;
  }
  // ── Helpers de fecha ──────────────────────────────────────────
  // Convierte una `Date` a clave local `YYYY-MM-DD`.
  dayKey(d3) {
    const y3 = d3.getFullYear();
    const m4 = String(d3.getMonth() + 1).padStart(2, "0");
    const day = String(d3.getDate()).padStart(2, "0");
    return `${y3}-${m4}-${day}`;
  }
  // Parsea `YYYY-MM-DD` (parte de fecha) a `Date` local; fallback defensivo a hoy.
  parseDay(s5) {
    const [y3, m4, d3] = s5.slice(0, 10).split("-").map(Number);
    if (y3 && m4 && d3) return new Date(y3, m4 - 1, d3);
    return /* @__PURE__ */ new Date();
  }
  // Extrae los minutos desde medianoche de una hora `HH:MM` o ISO (`...THH:MM`).
  minutesOf(time) {
    const t5 = time.includes("T") ? time.split("T")[1] : time;
    const [h4, m4] = (t5 || "").split(":").map(Number);
    if (Number.isFinite(h4)) return h4 * 60 + (Number.isFinite(m4) ? m4 : 0);
    return 0;
  }
  // Formatea minutos-desde-medianoche a `HH:MM`.
  fmtTime(mins) {
    const h4 = Math.floor(mins / 60);
    const m4 = mins % 60;
    return `${String(h4).padStart(2, "0")}:${String(m4).padStart(2, "0")}`;
  }
  // ── Geometría de la franja ────────────────────────────────────
  // Rango total de la franja en minutos (defensivo: end > start).
  get rangeMinutes() {
    const span = (this.endHour - this.startHour) * 60;
    return span > 0 ? span : 60;
  }
  // Número de celdas-slot de fondo según `slot`.
  get slotCount() {
    const step = this.slotMin > 0 ? this.slotMin : 60;
    return Math.max(1, Math.ceil(this.rangeMinutes / step));
  }
  // ── Navegación / eventos ──────────────────────────────────────
  // Cambia el día visible (delta en días) y emite `ok-nav`.
  navDay(delta) {
    const next = new Date(
      this.cursor.getFullYear(),
      this.cursor.getMonth(),
      this.cursor.getDate() + delta
    );
    this.cursor = next;
    this.dispatchEvent(
      new CustomEvent("ok-nav", {
        detail: { date: this.dayKey(next) },
        bubbles: true,
        composed: true
      })
    );
  }
  // Emite el click sobre un evento (sin propagar al slot de fondo).
  clickEvent(ev, e5) {
    e5.stopPropagation();
    if (this.suppressClick) return;
    this.dispatchEvent(
      new CustomEvent("ok-event-click", {
        detail: { id: ev.id, event: ev },
        bubbles: true,
        composed: true
      })
    );
  }
  // Emite el click sobre una celda-slot vacía de un recurso.
  clickSlot(resourceId, mins) {
    this.dispatchEvent(
      new CustomEvent("ok-slot-click", {
        detail: { resourceId, time: this.fmtTime(mins) },
        bubbles: true,
        composed: true
      })
    );
  }
  // ── Mover un bloque ───────────────────────────────────────────
  // Primer y último minuto pintables de la franja.
  get dayStartMin() {
    return this.startHour * 60;
  }
  // Dónde está un bloque AHORA: el gesto en curso y el movimiento sin confirmar mandan sobre la
  // prop, para que el bloque no vuelva a saltar a su sitio viejo entre el drop y el refresco.
  placement(ev) {
    if (this.drag?.id === ev.id) return this.drag;
    if (this.pending?.id === ev.id) return this.pending;
    return {
      resourceId: ev.resourceId,
      startMin: this.minutesOf(ev.start),
      endMin: this.minutesOf(ev.end)
    };
  }
  // ── Reparto de los solapes (side-by-side por clúster) ─────────
  //
  // Dos citas a la misma hora en el mismo carril NO pueden pintarse una encima de otra: en pantalla
  // solo existiría la de arriba, justo cuando hay que ver que hay dos personas citadas
  // (outfitkit#71). El reparto es el algoritmo clásico de las agendas —el de Google Calendar,
  // Outlook, Fresha, Vagaro, Square—: se agrupan las citas por solape TRANSITIVO (un clúster) y el
  // clúster se parte en tantos sub-carriles como haga falta.
  //
  // El detalle que hace que la agenda no se adelgace entera: cada bloque cae en el PRIMER sub-carril
  // ya libre, así que dos citas que no se pisan entre sí lo reutilizan. Una cadena A→B→C donde A y C
  // no se tocan ocupa DOS sub-carriles, no tres. Y un clúster no afecta a otro: la mañana llena no
  // parte la tarde vacía.
  //
  // Aquí el timeline es HORIZONTAL (el eje X es el tiempo), así que lo que se reparte es el ALTO de
  // la fila, no el ancho como en las agendas de día vertical.
  packLane(items) {
    const slots = /* @__PURE__ */ new Map();
    const sorted = [...items].sort(
      (a3, b3) => a3.at.startMin - b3.at.startMin || a3.at.endMin - b3.at.endMin || (a3.id < b3.id ? -1 : a3.id > b3.id ? 1 : 0)
    );
    let cluster = [];
    let laneEnds = [];
    let clusterEnd = -Infinity;
    const closeCluster = () => {
      const count = Math.max(1, laneEnds.length);
      for (const id of cluster) slots.get(id).count = count;
      cluster = [];
      laneEnds = [];
      clusterEnd = -Infinity;
    };
    for (const item of sorted) {
      if (item.at.startMin >= clusterEnd) closeCluster();
      let index = laneEnds.findIndex((end) => end <= item.at.startMin);
      if (index === -1) {
        index = laneEnds.length;
        laneEnds.push(item.at.endMin);
      } else {
        laneEnds[index] = item.at.endMin;
      }
      slots.set(item.id, { index, count: 1 });
      cluster.push(item.id);
      clusterEnd = Math.max(clusterEnd, item.at.endMin);
    }
    closeCluster();
    return slots;
  }
  // Geometría vertical de un bloque según su sub-carril. Con un solo ocupante no se toca nada: el
  // bloque sigue ocupando el alto entero del carril, exactamente como antes.
  stackStyle(slot) {
    if (slot.count <= 1) return "";
    return `top:calc(0.25rem + (100% - 0.5rem) * ${slot.index} / ${slot.count});height:calc((100% - 0.5rem) / ${slot.count} - ${STACK_GAP_PX}px);bottom:auto;`;
  }
  // Imanta el inicio a la rejilla y garantiza que el bloque entero cabe en la franja visible.
  snapStart(startMin, durationMin) {
    const step = this.snapMin > 0 ? this.snapMin : 1;
    const snapped = Math.round(startMin / step) * step;
    const last = this.dayStartMin + this.rangeMinutes - durationMin;
    return Math.min(Math.max(snapped, this.dayStartMin), Math.max(this.dayStartMin, last));
  }
  // Imanta el FIN a la rejilla: nunca por debajo de un `snap` de duración ni más allá de la franja.
  snapEnd(endMin, startMin) {
    const step = this.snapMin > 0 ? this.snapMin : 1;
    const snapped = Math.round(endMin / step) * step;
    const last = this.dayStartMin + this.rangeMinutes;
    return Math.min(Math.max(snapped, startMin + step), last);
  }
  // Único sitio donde nace un redimensionado (asa y teclado). Mismo contrato que el movimiento:
  // se pinta optimista y MANDA EL HOST; si el servidor lo rechaza, `revert()`.
  requestResize(ev, from, endMin) {
    if (endMin === from.endMin) return;
    const resized = { id: ev.id, ...from, endMin };
    this.pending = resized;
    const detail = {
      id: ev.id,
      start: this.fmtTime(from.startMin),
      end: this.fmtTime(endMin),
      from: { start: this.fmtTime(from.startMin), end: this.fmtTime(from.endMin) },
      event: ev,
      // Se comprueba la identidad para no deshacer el cambio SIGUIENTE si el revert llega tarde.
      revert: () => {
        if (this.pending === resized) this.pending = null;
      }
    };
    this.dispatchEvent(
      new CustomEvent("ok-event-resize", {
        detail,
        bubbles: true,
        composed: true
      })
    );
  }
  // Único sitio donde nace un movimiento (arrastre y teclado). Pinta optimista y pregunta al host.
  requestMove(ev, from, to) {
    if (to.resourceId === from.resourceId && to.startMin === from.startMin) return;
    const move = { id: ev.id, ...to };
    this.pending = move;
    const detail = {
      id: ev.id,
      resourceId: to.resourceId,
      start: this.fmtTime(to.startMin),
      end: this.fmtTime(to.endMin),
      from: {
        resourceId: from.resourceId,
        start: this.fmtTime(from.startMin),
        end: this.fmtTime(from.endMin)
      },
      event: ev,
      // Rechazo del host: el bloque vuelve. Se comprueba la identidad para no deshacer el
      // movimiento SIGUIENTE si el revert llega tarde.
      revert: () => {
        if (this.pending === move) this.pending = null;
      }
    };
    this.dispatchEvent(
      new CustomEvent("ok-event-move", {
        detail,
        bubbles: true,
        composed: true
      })
    );
  }
  capturePointer(target, pointerId) {
    try {
      target.setPointerCapture?.(pointerId);
    } catch {
    }
  }
  releasePointer(state2) {
    try {
      if (state2.captureTarget.hasPointerCapture?.(state2.pointerId)) {
        state2.captureTarget.releasePointerCapture?.(state2.pointerId);
      }
    } catch {
    }
  }
  startGesture(e5, ev, mode) {
    if (this.pointerDrag || e5.button !== 0) return;
    if (mode === "move" ? !this.movable : !this.resizable) return;
    const captureTarget = e5.currentTarget;
    const lane = captureTarget.closest(".lane");
    const laneWidth = lane?.getBoundingClientRect().width ?? 0;
    if (laneWidth <= 0) return;
    const state2 = {
      mode,
      pointerId: e5.pointerId,
      startX: e5.clientX,
      startY: e5.clientY,
      active: false,
      // Con ratón o lápiz el gesto ya está armado: el umbral en píxeles basta. En el ASA tampoco
      // hay pulsación mantenida ni con el dedo — el asa YA es el objetivo deliberado.
      held: mode === "resize" || e5.pointerType !== "touch",
      holdTimer: null,
      captureTarget,
      laneWidth,
      id: ev.id,
      from: this.placement(ev)
    };
    if (!state2.held) {
      state2.holdTimer = setTimeout(() => {
        state2.held = true;
        state2.holdTimer = null;
        this.heldId = state2.id;
      }, TOUCH_HOLD_MS);
    }
    this.pointerDrag = state2;
    this.capturePointer(captureTarget, e5.pointerId);
  }
  onEventPointerDown(e5, ev) {
    this.startGesture(e5, ev, "move");
  }
  // El asa gana sobre el cuerpo: se para la propagación para que el `pointerdown` del bloque no
  // llegue a ver este gesto. Sin esto los dos arrancarían con el mismo evento.
  onHandlePointerDown(e5, ev) {
    e5.stopPropagation();
    this.startGesture(e5, ev, "resize");
  }
  // Suelta el candidato y apaga su temporizador (una sola puerta de salida del gesto).
  endGesture(state2) {
    if (state2.holdTimer) clearTimeout(state2.holdTimer);
    this.releasePointer(state2);
    this.pointerDrag = null;
    this.heldId = null;
  }
  /** Elemento real bajo el puntero capturado, dentro del shadow root. */
  elementFromPoint(x2, y3) {
    const root = this.renderRoot;
    return root.elementFromPoint?.(x2, y3) ?? null;
  }
  // Cuántos minutos ha recorrido el puntero desde que empezó el gesto.
  travelledMinutes(e5, state2) {
    return (e5.clientX - state2.startX) / state2.laneWidth * this.rangeMinutes;
  }
  // Traduce las coordenadas del puntero a «qué carril y qué hora», imantado a la rejilla.
  dropTarget(e5, state2) {
    const duration = state2.from.endMin - state2.from.startMin;
    const startMin = this.snapStart(state2.from.startMin + this.travelledMinutes(e5, state2), duration);
    const hit = this.elementFromPoint(e5.clientX, e5.clientY);
    const lane = hit?.closest(".lane[data-resource-id]") ?? null;
    const resourceId = lane?.dataset.resourceId ?? state2.from.resourceId;
    return { resourceId, startMin, endMin: startMin + duration };
  }
  // Redimensionar solo mueve el FIN: ni la hora de inicio ni el recurso cambian.
  resizeTarget(e5, state2) {
    const endMin = this.snapEnd(state2.from.endMin + this.travelledMinutes(e5, state2), state2.from.startMin);
    return { ...state2.from, endMin };
  }
  // Dónde quedaría el bloque si se soltara aquí, según el gesto en curso.
  gestureTarget(e5, state2) {
    return state2.mode === "resize" ? this.resizeTarget(e5, state2) : this.dropTarget(e5, state2);
  }
  onPointerMove(e5) {
    const state2 = this.pointerDrag;
    if (!state2 || state2.pointerId !== e5.pointerId) return;
    const travelled = Math.hypot(e5.clientX - state2.startX, e5.clientY - state2.startY);
    if (!state2.held) {
      if (travelled >= TOUCH_HOLD_TOLERANCE_PX) this.endGesture(state2);
      return;
    }
    if (!state2.active) {
      const needsThreshold = state2.mode === "resize" || e5.pointerType !== "touch";
      if (needsThreshold && travelled < DRAG_THRESHOLD_PX) return;
      state2.active = true;
    }
    e5.preventDefault();
    this.drag = { id: state2.id, from: state2.from, ...this.gestureTarget(e5, state2) };
  }
  connectedCallback() {
    super.connectedCallback();
    this.addEventListener("touchmove", this.blockScrollWhileDragging, { passive: false });
  }
  suppressNextEventClick() {
    this.suppressClick = true;
    if (this.suppressClickTimer) clearTimeout(this.suppressClickTimer);
    this.suppressClickTimer = setTimeout(() => {
      this.suppressClick = false;
      this.suppressClickTimer = null;
    }, 0);
  }
  onPointerUp(e5) {
    const state2 = this.pointerDrag;
    if (!state2 || state2.pointerId !== e5.pointerId) return;
    this.endGesture(state2);
    if (!state2.active) return;
    e5.preventDefault();
    const to = this.gestureTarget(e5, state2);
    this.drag = null;
    this.suppressNextEventClick();
    const ev = this.events.find((candidate) => candidate.id === state2.id);
    if (!ev) return;
    if (state2.mode === "resize") this.requestResize(ev, state2.from, to.endMin);
    else this.requestMove(ev, state2.from, to);
  }
  onPointerCancel(e5) {
    const state2 = this.pointerDrag;
    if (!state2 || state2.pointerId !== e5.pointerId) return;
    this.endGesture(state2);
    this.drag = null;
  }
  // Teclado: el arrastre es un atajo, no la única vía (tables#16 hace esto mismo en el plano de
  // sala). Enter/Espacio abre el panel del módulo; las flechas mueven.
  onEventKeyDown(e5, ev) {
    if (e5.key === "Enter" || e5.key === " ") {
      e5.preventDefault();
      this.clickEvent(ev, e5);
      return;
    }
    const horizontal = e5.key === "ArrowRight" || e5.key === "ArrowLeft";
    const snap = this.snapMin > 0 ? this.snapMin : 1;
    if (this.resizable && horizontal && e5.shiftKey) {
      const from2 = this.placement(ev);
      const endMin = this.snapEnd(from2.endMin + (e5.key === "ArrowRight" ? snap : -snap), from2.startMin);
      if (endMin === from2.endMin) return;
      e5.preventDefault();
      e5.stopPropagation();
      this.requestResize(ev, from2, endMin);
      this.announcement = `${ev.title} \u2014 ${this.fmtTime(from2.startMin)} \xB7 ${this.fmtTime(endMin)}`;
      return;
    }
    if (!this.movable) return;
    const from = this.placement(ev);
    const duration = from.endMin - from.startMin;
    const step = snap * (e5.shiftKey ? 4 : 1);
    let to = null;
    if (e5.key === "ArrowRight" || e5.key === "ArrowLeft") {
      const delta = e5.key === "ArrowRight" ? step : -step;
      to = { ...from, startMin: this.snapStart(from.startMin + delta, duration) };
      to.endMin = to.startMin + duration;
    } else if (e5.key === "ArrowDown" || e5.key === "ArrowUp") {
      const index = this.resources.findIndex((r6) => r6.id === from.resourceId);
      const next = index + (e5.key === "ArrowDown" ? 1 : -1);
      if (index === -1 || next < 0 || next >= this.resources.length) return;
      to = { ...from, resourceId: this.resources[next].id };
    }
    if (!to) return;
    e5.preventDefault();
    e5.stopPropagation();
    this.requestMove(ev, from, to);
    const resource = this.resources.find((r6) => r6.id === to.resourceId);
    this.announcement = `${ev.title} \u2014 ${this.fmtTime(to.startMin)} \xB7 ${resource?.label ?? ""}`;
  }
  // ── Etiquetas ─────────────────────────────────────────────────
  // Etiqueta del día del cursor (capitalizada vía CSS).
  dayLabel() {
    return this.cursor.toLocaleDateString(this.locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    });
  }
  // Iniciales para el avatar de respaldo (sin imagen).
  initials(label) {
    const parts = label.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2);
    return parts[0][0] + parts[parts.length - 1][0];
  }
  // ── Render parcial ────────────────────────────────────────────
  // Cabecera horaria: una columna por hora del rango.
  renderTimelineHead() {
    const hours = [];
    for (let h4 = this.startHour; h4 < this.endHour; h4++) hours.push(h4);
    return b2`<div class="timeline">
      ${hours.map(
      (h4) => b2`<div class="hour">${String(h4).padStart(2, "0")}:00</div>`
    )}
    </div>`;
  }
  // Lane (pista) de un recurso: celdas-slot de fondo + bloques de evento posicionados.
  renderLane(resource) {
    const total = this.rangeMinutes;
    const startMin = this.startHour * 60;
    const step = this.slotMin > 0 ? this.slotMin : 60;
    const count = this.slotCount;
    const cells = [];
    for (let i7 = 0; i7 < count; i7++) {
      const slotStart = startMin + i7 * step;
      const left = (slotStart - startMin) / total * 100;
      const width = step / total * 100;
      cells.push(
        b2`<div
          class="slot"
          style=${`left:${left}%;width:${width}%`}
          @click=${() => this.clickSlot(resource.id, slotStart)}
        ></div>`
      );
    }
    const ghost = this.drag && this.drag.from.resourceId === resource.id ? (() => {
      const s5 = Math.max(this.drag.from.startMin, startMin);
      const e5 = Math.min(this.drag.from.endMin, startMin + total);
      if (e5 <= s5) return "";
      return b2`<div
              class="ghost"
              style=${`left:${(s5 - startMin) / total * 100}%;width:${(e5 - s5) / total * 100}%`}
            ></div>`;
    })() : "";
    const mine = this.events.filter((ev) => this.placement(ev).resourceId === resource.id);
    const slots = this.packLane(mine.map((ev) => ({ id: ev.id, at: this.placement(ev) })));
    const stacks = Math.max(1, ...[...slots.values()].map((s5) => s5.count));
    const blocks = mine.map((ev) => {
      const at = this.placement(ev);
      const slot = slots.get(ev.id) ?? { index: 0, count: 1 };
      const s5 = Math.max(at.startMin, startMin);
      const e5 = Math.min(at.endMin, startMin + total);
      if (e5 <= s5) return "";
      const left = (s5 - startMin) / total * 100;
      const width = (e5 - s5) / total * 100;
      const gesturing = this.drag?.id === ev.id;
      const resizing = gesturing && this.pointerDrag?.mode === "resize";
      const dragging = gesturing && !resizing;
      const held = this.heldId === ev.id;
      const time = `${this.fmtTime(at.startMin)} \u2013 ${this.fmtTime(at.endMin)}`;
      return b2`<div
          class=${`event${this.movable ? " movable" : ""}${held ? " held" : ""}${dragging ? " dragging" : ""}${resizing ? " resizing" : ""}`}
          data-event-id=${ev.id}
          data-lane-index=${slot.index}
          data-lane-count=${slot.count}
          style=${`left:${left}%;width:${width}%;background:${ev.color || "var(--primary-color)"};${this.stackStyle(slot)}`}
          title=${ev.title}
          role="button"
          tabindex="0"
          aria-label=${`${ev.title}, ${time}, ${resource.label}`}
          @click=${(domEv) => this.clickEvent(ev, domEv)}
          @keydown=${(domEv) => this.onEventKeyDown(domEv, ev)}
          @pointerdown=${(domEv) => this.onEventPointerDown(domEv, ev)}
        >
          <span class="event-title">${ev.title}</span>
          <span class="event-time">${time}</span>
          ${this.resizable ? b2`<span
                class="resize-handle"
                data-resize-handle
                aria-hidden="true"
                @click=${(domEv) => domEv.stopPropagation()}
                @pointerdown=${(domEv) => this.onHandlePointerDown(domEv, ev)}
              ></span>` : ""}
        </div>`;
    });
    return b2`<div
      class="lane"
      data-resource-id=${resource.id}
      data-stacks=${stacks}
      style=${`--stacks:${stacks}`}
    >
      ${cells}${ghost}${blocks}
    </div>`;
  }
  // Fila completa de un recurso: label sticky + lane.
  renderRow(resource) {
    return b2`<div class="row">
      <div class="resource">
        ${resource.avatar ? b2`<img class="avatar" src=${resource.avatar} alt="" loading="lazy" />` : b2`<span class="avatar-fallback">${this.initials(resource.label)}</span>`}
        <span class="resource-label">${resource.label}</span>
      </div>
      ${this.renderLane(resource)}
    </div>`;
  }
  render() {
    if (!this.seeded) {
      if (this.date) this.cursor = this.parseDay(this.date);
      this.seeded = true;
    }
    const hourCount = Math.max(1, this.endHour - this.startHour);
    const timelineWidth = `calc(${hourCount} * var(--hour-width))`;
    const gridStyle = `width:calc(var(--resource-width) + ${timelineWidth})`;
    return b2`<div class="toolbar">
        <ion-button
          fill="clear"
          size="small"
          aria-label=${this.t.prevDay}
          @click=${() => this.navDay(-1)}
        >
          <ion-icon slot="icon-only" .icon=${iconChevronBackOutline}></ion-icon>
        </ion-button>
        <span class="title">${this.dayLabel()}</span>
        <ion-button
          fill="clear"
          size="small"
          aria-label=${this.t.nextDay}
          @click=${() => this.navDay(1)}
        >
          <ion-icon slot="icon-only" .icon=${iconChevronForwardOutline}></ion-icon>
        </ion-button>
      </div>
      <div class="scroll">
        <div
          class="grid"
          style=${gridStyle}
          @pointermove=${this.onPointerMove}
          @pointerup=${this.onPointerUp}
          @pointercancel=${this.onPointerCancel}
        >
          <div class="head-row">
            <div class="corner"></div>
            ${this.renderTimelineHead()}
          </div>
          ${this.resources.length ? this.resources.map((r6) => this.renderRow(r6)) : b2`<div class="empty">${this.t.empty}</div>`}
        </div>
      </div>
      <div class="sr-only" role="status" aria-live="polite">${this.announcement}</div>`;
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener("touchmove", this.blockScrollWhileDragging);
    if (this.pointerDrag) this.endGesture(this.pointerDrag);
    if (this.suppressClickTimer) clearTimeout(this.suppressClickTimer);
    this.suppressClickTimer = null;
  }
};
__decorateClass5([
  n4({ attribute: false })
], OkScheduler.prototype, "resources");
__decorateClass5([
  n4({ attribute: false })
], OkScheduler.prototype, "events");
__decorateClass5([
  n4()
], OkScheduler.prototype, "date");
__decorateClass5([
  n4({ type: Number, attribute: "start-hour" })
], OkScheduler.prototype, "startHour");
__decorateClass5([
  n4({ type: Number, attribute: "end-hour" })
], OkScheduler.prototype, "endHour");
__decorateClass5([
  n4({ type: Number, attribute: "slot-minutes" })
], OkScheduler.prototype, "slotMin");
__decorateClass5([
  n4()
], OkScheduler.prototype, "locale");
__decorateClass5([
  n4({ attribute: false })
], OkScheduler.prototype, "labels");
__decorateClass5([
  n4({ type: Boolean, reflect: true })
], OkScheduler.prototype, "movable");
__decorateClass5([
  n4({ type: Boolean, reflect: true })
], OkScheduler.prototype, "resizable");
__decorateClass5([
  n4({ type: Number, attribute: "snap-minutes" })
], OkScheduler.prototype, "snapMin");
__decorateClass5([
  r5()
], OkScheduler.prototype, "cursor");
__decorateClass5([
  r5()
], OkScheduler.prototype, "drag");
__decorateClass5([
  r5()
], OkScheduler.prototype, "pending");
__decorateClass5([
  r5()
], OkScheduler.prototype, "announcement");
__decorateClass5([
  r5()
], OkScheduler.prototype, "heldId");
define("ok-scheduler", OkScheduler);

// ui/components/erp-appointments-series/erp-appointments-series.ts
var CATALOG2 = { es: es_default, en: en_default };
function erplora2() {
  const c5 = globalThis.erplora;
  if (!c5) throw new Error("erplora SDK not initialised by the shell");
  return c5;
}
function rows2(r6) {
  if (Array.isArray(r6)) return r6;
  if (r6 && typeof r6 === "object" && Array.isArray(r6.rows)) {
    return r6.rows;
  }
  return [];
}
var FREQUENCIES = ["daily", "weekly", "biweekly", "monthly"];
var FREQUENCY_KEYS = {
  daily: "ui.freqDaily",
  weekly: "ui.freqWeekly",
  biweekly: "ui.freqBiweekly",
  monthly: "ui.freqMonthly"
};
var WEEKDAY_KEYS = [
  "ui.dayMonday",
  "ui.dayTuesday",
  "ui.dayWednesday",
  "ui.dayThursday",
  "ui.dayFriday",
  "ui.daySaturday",
  "ui.daySunday"
];
var ALIGNS_TO_WEEKDAY = ["weekly", "biweekly"];
var ErpAppointmentsSeries = class extends i3 {
  constructor() {
    super(...arguments);
    this.series = [];
    this.loading = true;
    this.error = "";
    this.saving = false;
    this.busySeriesId = "";
    this.editingId = "";
    this.template = null;
    this.occurrences = [];
    this.fromOccurrence = "";
    this.editFrequency = "";
    this.editDayOfWeek = "";
    this.editTime = "";
    this.editDuration = "";
    this.offLocale = null;
  }
  static {
    this.styles = i`
    :host { display:flex; flex-direction:column; min-height:0; flex:1 1 auto;
            font-family: system-ui, sans-serif; color: var(--ion-text-color, #1c1b18); }
    .page { display:flex; flex-direction:column; gap:.5rem; min-height:0; flex:1 1 auto; }
    .page > ok-data-table { flex:1 1 auto; min-height:0; }
    .form { display:flex; flex-direction:column; gap:.75rem; padding:.25rem 0; }
    /* Dos columnas en cuanto hay sitio y una sola en móvil: el panel es el mismo en los tres
       tamaños, lo que cambia es cuántos campos caben por fila. */
    .grid { display:grid; grid-template-columns:1fr; gap:.75rem; }
    @media (min-width: 540px) { .grid { grid-template-columns:1fr 1fr; } }
    .ctx { margin:0; font-size:.9rem; color: var(--ion-color-medium, #8b897f); }
    .ctx strong { color: var(--ion-text-color, #1c1b18); }
    .loading, .empty { color: var(--ion-color-medium, #8b897f); font-size:.9rem; margin:.25rem 0; }
  `;
  }
  async connectedCallback() {
    super.connectedCallback();
    this.offLocale = erplora2().on("erplora:locale-changed", () => this.requestUpdate());
    await this.refresh();
  }
  disconnectedCallback() {
    this.offLocale?.();
    this.offLocale = null;
    super.disconnectedCallback();
  }
  async refresh() {
    this.loading = true;
    this.error = "";
    try {
      this.series = rows2(await erplora2().query("appointments.recurring.list"));
    } catch (e5) {
      this.series = [];
      this.error = e5 instanceof Error && e5.message ? e5.message : erplora2().t(CATALOG2, "ui.seriesLoadError");
    } finally {
      this.loading = false;
    }
  }
  dataTable() {
    return this.renderRoot.querySelector("ok-data-table");
  }
  /** Carga la plantilla AUTORITATIVA de la serie (la lista no trae los tres ids) y lo que ya está
   *  reservado, que es lo que decide dónde cae el corte y lo que hay que avisar antes de guardar. */
  async loadTemplate(recurringId) {
    const tmpl = rows2(
      await erplora2().query("appointments.recurring.get", { recurring_id: recurringId })
    )[0];
    return tmpl ?? null;
  }
  async openSeries(row) {
    const id = String(row.id ?? "");
    if (!id) return;
    this.error = "";
    try {
      const [tmpl, occ] = await Promise.all([
        this.loadTemplate(id),
        erplora2().query("appointments.recurring.occurrences", { recurring_id: id })
      ]);
      if (!tmpl) {
        this.error = erplora2().t(CATALOG2, "ui.seriesNotFound");
        return;
      }
      this.template = tmpl;
      this.occurrences = rows2(occ);
      this.editingId = id;
      this.editFrequency = tmpl.frequency ?? "";
      this.editDayOfWeek = tmpl.day_of_week === null || tmpl.day_of_week === void 0 ? "" : String(tmpl.day_of_week);
      this.editTime = tmpl.time ?? "";
      this.editDuration = String(tmpl.duration_minutes ?? "");
      const today2 = todayISO();
      this.fromOccurrence = this.occurrences.map((o7) => o7.occurrence_date).find((d3) => d3 >= today2) ?? today2;
      await this.updateComplete;
      this.dataTable()?.open("create");
    } catch (e5) {
      this.error = e5 instanceof Error && e5.message ? e5.message : erplora2().t(CATALOG2, "ui.seriesLoadError");
    }
  }
  closePanel() {
    this.editingId = "";
    this.template = null;
    this.occurrences = [];
    this.dataTable()?.close();
  }
  /** Lo que de verdad cambió. Se manda SOLO eso: `recurring.update` compara contra la plantilla
   *  para decidir si la pauta cambió, y reenviar lo idéntico no aporta nada; mandar el payload
   *  entero además haría que un campo que la pantalla no supo leer pisara el valor guardado. */
  changedFields() {
    const tmpl = this.template;
    if (!tmpl) return {};
    const changed = {};
    if (this.editTime && this.editTime !== tmpl.time) changed.time = this.editTime;
    const minutes = Math.trunc(Number(this.editDuration));
    if (Number.isFinite(minutes) && minutes >= 1 && minutes !== tmpl.duration_minutes) {
      changed.duration_minutes = minutes;
    }
    if (this.editFrequency && this.editFrequency !== tmpl.frequency) {
      changed.frequency = this.editFrequency;
    }
    const dow = this.editDayOfWeek === "" ? null : Math.trunc(Number(this.editDayOfWeek));
    const current = tmpl.day_of_week === void 0 ? null : tmpl.day_of_week;
    if (dow !== current) changed.day_of_week = dow;
    return changed;
  }
  /** Cuántas citas ya reservadas alcanza el cambio: las que quedan por delante del corte y siguen
   *  siendo un plan. Las ya cobradas se nombran aparte porque NO se van a tocar. */
  get affected() {
    const from = this.fromOccurrence;
    let upcoming = 0;
    let invoiced = 0;
    for (const o7 of this.occurrences) {
      if (!from || o7.occurrence_date < from) continue;
      if (o7.status !== "pending" && o7.status !== "confirmed") continue;
      if (o7.converted_sale_id) invoiced += 1;
      else upcoming += 1;
    }
    return { upcoming, invoiced };
  }
  async submitEdit(ev) {
    ev.preventDefault?.();
    const tmpl = this.template;
    if (!tmpl || this.saving) return;
    const changed = this.changedFields();
    if (Object.keys(changed).length === 0) {
      this.closePanel();
      return;
    }
    this.saving = true;
    this.error = "";
    try {
      const result = await erplora2().command("appointments.recurring.update", {
        recurring_id: this.editingId,
        scope: "this_and_following",
        from_occurrence_date: this.fromOccurrence,
        ...changed
      });
      if (result?.pattern_changed === true) {
        await this.bookWindow(String(result.recurring_id ?? this.editingId), tmpl);
      }
      this.notifyOutcome(result);
      this.closePanel();
      await this.refresh();
    } catch (e5) {
      this.error = e5 instanceof Error && e5.message ? e5.message : erplora2().t(CATALOG2, "ui.seriesSaveError");
    } finally {
      this.saving = false;
    }
  }
  /** Lo que NO se movió se DICE. Callarlo es el fallo nº1 que reportan los foros de este gesto. */
  notifyOutcome(result) {
    if (!result) return;
    const t5 = (k2, p4) => erplora2().t(CATALOG2, k2, p4);
    const message = t5("ui.seriesUpdateOutcome", {
      moved: Number(result.moved ?? 0),
      cancelled: Number(result.cancelled_pattern_change ?? 0),
      locked: Number(result.locked_invoiced ?? 0)
    });
    erplora2().notify?.({ type: "success", message });
  }
  async bookWindow(recurringId, tmpl) {
    await erplora2().command("appointments.recurring.materialize", {
      recurring_id: recurringId,
      customer_id: tmpl.customer_id ?? "",
      service_id: tmpl.service_id ?? "",
      staff_id: tmpl.staff_id ?? ""
    });
  }
  /** Materializar la ventana desde la lista: la serie ya existe, lo que falta son sus citas. */
  async materializeSeries(row) {
    const id = String(row.id ?? "");
    if (!id) return;
    this.error = "";
    try {
      const tmpl = await this.loadTemplate(id);
      if (!tmpl) {
        this.error = erplora2().t(CATALOG2, "ui.seriesNotFound");
        return;
      }
      await this.bookWindow(id, tmpl);
      erplora2().notify?.({ type: "success", message: erplora2().t(CATALOG2, "ui.seriesMaterialized") });
    } catch (e5) {
      this.error = e5 instanceof Error && e5.message ? e5.message : erplora2().t(CATALOG2, "ui.seriesMaterializeError");
    }
  }
  async deleteSeries(row) {
    const id = String(row.id ?? "");
    if (!id) return;
    this.error = "";
    try {
      await erplora2().command("appointments.recurring.delete", { recurring_id: id });
      await this.refresh();
    } catch (e5) {
      this.error = e5 instanceof Error && e5.message ? e5.message : erplora2().t(CATALOG2, "ui.seriesDeleteError");
    }
  }
  /** Desactiva/reactiva una serie sin borrarla (appointments#110). Una desactivada SIGUE en la
   *  lista (`recurring_list.sql` ya no la filtra) — solo deja de ofrecerse para materializar
   *  citas nuevas hasta que se reactiva. */
  async toggleSeriesActive(row, nextActive, toggle) {
    const id = String(row.id ?? "");
    if (!id || this.busySeriesId) return;
    this.busySeriesId = id;
    this.error = "";
    try {
      if (nextActive) {
        await erplora2().command("appointments.recurring.activate", { recurring_id: id });
      } else {
        await erplora2().command("appointments.recurring.deactivate", { recurring_id: id });
      }
      await this.refresh();
    } catch (e5) {
      this.error = e5 instanceof Error && e5.message ? e5.message : erplora2().t(CATALOG2, "ui.seriesToggleActiveError");
      if (toggle) toggle.checked = !nextActive;
    } finally {
      this.busySeriesId = "";
    }
  }
  onRowAction(ev) {
    const { action, row } = ev.detail ?? {};
    if (!row) return;
    if (action === "edit") void this.openSeries(row);
    else if (action === "materialize") void this.materializeSeries(row);
    else if (action === "delete") void this.deleteSeries(row);
  }
  /** La pauta en una frase, que es como la lee una recepcionista («Cada semana · lunes · 11:00»). */
  patternLabel(row) {
    const t5 = (k2) => erplora2().t(CATALOG2, k2);
    const parts = [t5(FREQUENCY_KEYS[row.frequency] ?? row.frequency)];
    if (ALIGNS_TO_WEEKDAY.includes(row.frequency) && row.day_of_week !== null && row.day_of_week !== void 0) {
      parts.push(t5(WEEKDAY_KEYS[row.day_of_week] ?? String(row.day_of_week)));
    }
    if (row.time) parts.push(row.time);
    return parts.join(" \xB7 ");
  }
  get columns() {
    const t5 = (k2) => erplora2().t(CATALOG2, k2);
    return [
      { key: "customer_name", header: t5("ui.colCustomer") },
      { key: "service_name", header: t5("ui.colService") },
      { key: "staff_name", header: t5("ui.colStaff"), format: (r6) => r6.staff_name || "\u2014" },
      { key: "frequency", header: t5("ui.colPattern"), format: (r6) => this.patternLabel(r6) },
      { key: "start_date", header: t5("ui.colStarts") },
      { key: "end_date", header: t5("ui.colEnds"), format: (r6) => r6.end_date || t5("ui.seriesNoEnd") },
      {
        key: "is_active",
        header: t5("ui.colStatus"),
        // Inline toggle (the `erp-inventory-products` pattern for an `is_active` flag): the list
        // already brings active AND inactive rows, so the row is painted and switched without
        // opening anything. Disabled while a change is in flight: that is its loading state.
        render: (r6) => b2`
          <ion-toggle
            data-testid=${`appointments-series-active-${String(r6.id)}`}
            aria-label=${t5("ui.seriesActive")}
            ?checked=${!!r6.is_active}
            ?disabled=${!!this.busySeriesId}
            @ionChange=${(e5) => this.toggleSeriesActive(r6, e5.target.checked, e5.target)}
          ></ion-toggle>
        `
      }
    ];
  }
  get rowActions() {
    const t5 = (k2) => erplora2().t(CATALOG2, k2);
    return [
      { id: "edit", label: t5("ui.actionEditSeries"), icon: "create-outline", color: "primary" },
      { id: "materialize", label: t5("ui.actionMaterialize"), icon: "calendar-number-outline", color: "success" },
      { id: "delete", label: t5("ui.actionDelete"), icon: "trash-outline", color: "danger" }
    ];
  }
  render() {
    const t5 = (k2, p4) => erplora2().t(CATALOG2, k2, p4);
    return b2`<div class="page">
      ${this.error ? b2`<ok-inline-feedback data-testid="appointments-series-error" tone="danger" icon="alert-circle-outline">${this.error}</ok-inline-feedback>` : A}
      <ok-data-table
        testid="appointments-series-table"
        .fill=${true}
        .views=${true}
        .cardTitle=${(row) => String(row.customer_name ?? "")}
        .columns=${this.columns}
        .rows=${this.series}
        .searchKeys=${["customer_name", "service_name", "staff_name"]}
        .searchPlaceholder=${t5("ui.seriesSearchPlaceholder")}
        .actions=${this.rowActions}
        @rowAction=${(e5) => this.onRowAction(e5)}
        .labels=${{ newRecord: t5("ui.seriesEditTitle") }}
        .emptyMessage=${this.loading ? t5("ui.loading") : t5("ui.seriesEmpty")}
      >
        ${this.editingId ? this.renderEditForm(t5) : A}
      </ok-data-table>
    </div>`;
  }
  renderEditForm(t5) {
    const tmpl = this.template;
    if (!tmpl) return A;
    const { upcoming, invoiced } = this.affected;
    const booked = this.occurrences.length;
    return b2`<form slot="create" data-testid="appointments-series-form" data-mode="series-edit" class="form" @submit=${(e5) => this.submitEdit(e5)}>
      <p class="ctx" data-role="series-context">
        <strong>${tmpl.customer_name}</strong> · ${tmpl.service_name} · ${tmpl.staff_name || "\u2014"}
      </p>
      <!-- Una serie PARTIDA son dos mitades encadenadas, y decirlo es la mitad de poder entenderla:
           sin esto, la mitad nueva parece una serie que apareció de la nada. -->
      ${tmpl.split_from_id ? b2`<ok-inline-feedback data-testid="appointments-series-split-from" data-role="split-from" tone="info" icon="git-branch-outline"
            >${t5("ui.seriesSplitFrom", { id: tmpl.split_from_id })}</ok-inline-feedback
          >` : A}
      <p class="ctx" data-role="series-counts">
        ${t5("ui.seriesBookedCount", { booked, from: this.fromOccurrence, upcoming })}
      </p>
      <!-- EL RECUENTO ANTES DE CONFIRMAR. Mover el día de una serie le cambia TODAS las citas a la
           clienta; un aviso genérico no basta, y lo que ya está cobrado no se toca — se nombra. -->
      ${invoiced > 0 ? b2`<ok-inline-feedback data-testid="appointments-series-locked" data-role="series-locked" tone="warning" icon="lock-closed-outline"
            >${t5("ui.seriesLockedInvoiced", { invoiced })}</ok-inline-feedback
          >` : A}
      <div class="grid">
        <ion-select
          data-testid="appointments-series-frequency"
          data-role="series-frequency"
          label=${t5("ui.fieldFrequency")}
          label-placement="floating"
          .value=${this.editFrequency}
          @ionChange=${(e5) => this.editFrequency = e5.target.value}
        >
          ${FREQUENCIES.map((f3) => b2`<ion-select-option .value=${f3}>${t5(FREQUENCY_KEYS[f3])}</ion-select-option>`)}
        </ion-select>
        ${ALIGNS_TO_WEEKDAY.includes(this.editFrequency) ? b2`<ion-select
              data-testid="appointments-series-day"
              data-role="series-day"
              label=${t5("ui.fieldWeekday")}
              label-placement="floating"
              .value=${this.editDayOfWeek}
              @ionChange=${(e5) => this.editDayOfWeek = e5.target.value}
            >
              <ion-select-option value="">${t5("ui.weekdayAny")}</ion-select-option>
              ${WEEKDAY_KEYS.map((k2, i7) => b2`<ion-select-option .value=${String(i7)}>${t5(k2)}</ion-select-option>`)}
            </ion-select>` : A}
        <ion-input
          data-testid="appointments-series-time"
          data-role="series-time"
          label=${t5("ui.fieldTime")}
          label-placement="floating"
          type="time"
          .value=${this.editTime}
          @ionInput=${(e5) => this.editTime = e5.target.value}
        ></ion-input>
        <ion-input
          data-testid="appointments-series-duration"
          data-role="series-duration"
          label=${t5("ui.fieldMinutes")}
          label-placement="floating"
          type="number"
          min="1"
          .value=${this.editDuration}
          @ionInput=${(e5) => this.editDuration = e5.target.value}
        ></ion-input>
      </div>
      <ok-inline-feedback data-testid="appointments-series-scope-hint" tone="info" icon="information-circle-outline"
        >${t5("ui.seriesScopeHint", { from: this.fromOccurrence })}</ok-inline-feedback
      >
      <ion-button data-testid="appointments-series-submit" type="submit" expand="block" .disabled=${this.saving}>${t5("ui.seriesSave")}</ion-button>
    </form>`;
  }
};
__decorateClass([
  r5()
], ErpAppointmentsSeries.prototype, "series", 2);
__decorateClass([
  r5()
], ErpAppointmentsSeries.prototype, "loading", 2);
__decorateClass([
  r5()
], ErpAppointmentsSeries.prototype, "error", 2);
__decorateClass([
  r5()
], ErpAppointmentsSeries.prototype, "saving", 2);
__decorateClass([
  r5()
], ErpAppointmentsSeries.prototype, "busySeriesId", 2);
__decorateClass([
  r5()
], ErpAppointmentsSeries.prototype, "editingId", 2);
__decorateClass([
  r5()
], ErpAppointmentsSeries.prototype, "template", 2);
__decorateClass([
  r5()
], ErpAppointmentsSeries.prototype, "occurrences", 2);
__decorateClass([
  r5()
], ErpAppointmentsSeries.prototype, "fromOccurrence", 2);
__decorateClass([
  r5()
], ErpAppointmentsSeries.prototype, "editFrequency", 2);
__decorateClass([
  r5()
], ErpAppointmentsSeries.prototype, "editDayOfWeek", 2);
__decorateClass([
  r5()
], ErpAppointmentsSeries.prototype, "editTime", 2);
__decorateClass([
  r5()
], ErpAppointmentsSeries.prototype, "editDuration", 2);
define("erp-appointments-series", ErpAppointmentsSeries);

// ui/components/erp-appointments-list/erp-appointments-list.ts
var CATALOG3 = { es: es_default, en: en_default };
var STATUS_KEYS2 = {
  pending: "ui.statusPending",
  confirmed: "ui.statusConfirmed",
  in_progress: "ui.statusInProgress",
  completed: "ui.statusCompleted",
  cancelled: "ui.statusCancelled",
  no_show: "ui.statusNoShow"
};
var STATUS_COLORS = {
  pending: "var(--ion-color-medium, #92949c)",
  confirmed: "var(--ion-color-primary, #3880ff)",
  in_progress: "var(--ion-color-warning, #ffc409)",
  completed: "var(--ion-color-success, #2dd36f)",
  cancelled: "var(--ion-color-danger, #eb445a)",
  no_show: "var(--ion-color-danger, #eb445a)"
};
var UNASSIGNED = "unassigned";
var RESCHEDULABLE = ["pending", "confirmed"];
function erplora3() {
  const c5 = globalThis.erplora;
  if (!c5) throw new Error("erplora SDK no inicializado por el shell");
  return c5;
}
function catalogError(code) {
  for (const lang of [erplora3().locale, "en"]) {
    const dict = CATALOG3[lang]?.errors;
    const text = dict?.[code];
    if (typeof text === "string" && text) return text;
  }
  return "";
}
function domainErrorText(e5, fallbackKey) {
  const code = e5?.code;
  const message = e5 instanceof Error ? e5.message : "";
  if (typeof code === "string" && code.startsWith("appointments.")) {
    const text = catalogError(code);
    if (text) return text;
  }
  return message || erplora3().t(CATALOG3, fallbackKey);
}
function rows3(r6) {
  if (Array.isArray(r6)) return r6;
  if (r6 && typeof r6 === "object" && Array.isArray(r6.rows)) {
    return r6.rows;
  }
  return [];
}
var fmtTime = (iso) => formatWallTime(iso, businessTimezone(), erplora3().locale);
var ErpAppointmentsList = class extends i3 {
  constructor() {
    super(...arguments);
    this.items = [];
    this.loading = true;
    this.error = "";
    this.formError = "";
    this.saving = false;
    this.day = todayISO();
    this.statusFilter = "";
    this.view = "list";
    this.customers = [];
    this.services = [];
    this.staffMembers = [];
    this.settings = {};
    this.newCustomerId = "";
    this.newServiceId = "";
    this.newStaffId = "";
    this.newStart = "";
    this.newDuration = "";
    this.rescheduleId = "";
    this.rescheduleStart = "";
    this.rescheduleDuration = "";
    this.rescheduleStaffName = "";
    this.rescheduleStaffId = "";
    this.rescheduleSeriesId = "";
    this.rescheduleOccurrence = "";
    this.askingSeriesScope = false;
    this.seriesScope = "this_only";
    this.overlapPrompt = "";
    /** Quien está esperando la respuesta del aviso. `null` = nadie pregunta ahora mismo. */
    this.overlapDecision = null;
    // i18n (ADR-0055): re-renderiza al recibir `erplora:locale-changed`.
    this.onLocaleChange = () => this.requestUpdate();
  }
  static {
    this.styles = i`
    :host { display:flex; flex-direction:column; height:100%; min-height:0; font-family: system-ui, sans-serif; color: var(--ion-text-color, #1c1b18); }
    /* La vista llena el alto: el data-table ocupa el resto (scroll interno, pie fijo). */
    .page { display:flex; flex-direction:column; min-height:0; flex:1 1 auto; }
    .page > ok-data-table, .page > ok-scheduler { flex:1 1 auto; min-height:0; }
    /* ALCANCE de la consulta (día + estado) y modo de vista: no son filtros de columna.
       appointments#93 · UNA fila, no tres. Medido a 390 px, este bloque ocupaba ~300 px: era
       flex-wrap:wrap con tres controles a tamaño completo (el input de fecha con etiqueta
       flotante, el select de estado y el segment), y en un móvil cada uno caía a su propia línea,
       así que la primera cita empezaba por debajo del 55 % de la pantalla. nowrap + controles
       que ENCOGEN es lo que hacen Fresha, Vagaro, Square Appointments y Google Calendar: el día
       manda y ocupa el hueco libre, lo secundario se estrecha. Mismo movimiento que tables#64 y
       kitchen#60. */
    .filters { display:flex; gap:.5rem; align-items:center; margin:0 0 .5rem; flex-wrap:nowrap; }
    /* El día: paso atrás · fecha · paso adelante, como una sola pieza. Se queda con el ancho que
       sobre (min-width:0 para que de verdad pueda encoger dentro de un flex). */
    .filters .daynav { display:flex; align-items:center; gap:.15rem; flex:1 1 auto; min-width:0; }
    /* 6.5rem es lo que mide una fecha completa (17/08/2026) en el input nativo: por debajo, el
       navegador la CORTA y la agenda deja de decir qué día está enseñando. El tope de 11rem es lo
       contrario: en un escritorio ancho, un input elástico separaba el paso adelante media
       pantalla del día que iba a cambiar, y dejaban de leerse como un solo mando. */
    .filters .daynav ion-input { flex:1 1 auto; min-width:6.5rem; max-width:11rem; }
    /* 44×44 es el suelo táctil (Ionic lo aplica a sus propios controles y es lo que exige el QA de
       las tres ventanas): un paso de día de 28 px se falla con el pulgar en una tablet de barra. */
    .filters .daynav ion-button { flex:0 0 auto; height:44px; width:44px; --padding-start:.25rem; --padding-end:.25rem; margin:0; }
    .filters ion-select { flex:0 1 9rem; min-width:5.5rem; }
    /* Ionic le da al host de ion-segment un width:100%: a solas, ES una fila entera. */
    .filters ion-segment { flex:0 0 auto; width:auto; margin-left:auto; }
    .filters ion-segment-button { min-height:44px; --padding-start:.5rem; --padding-end:.5rem; text-transform:none; }
    .filters ion-segment-button ion-icon { font-size:1.15rem; }
    /* En un teléfono el texto de la vista lo dice el icono: «Por profesional» son 120 px que
       empujan el día fuera de la fila. El nombre accesible sigue en el aria-label. */
    @media (max-width: 640px) {
      .filters { gap:.25rem; }
      .filters ion-segment-button ion-label { display:none; }
      .filters ion-segment-button { --padding-start:.2rem; --padding-end:.2rem; min-width:2.3rem; }
      /* 40 px de ancho (44 de alto, el suelo táctil se mantiene): son los 8 px que le faltan al
         estado para escribir «Todos» entero en 390 px. */
      .filters .daynav ion-button { width:40px; }
      .filters ion-select { flex:0 1 5.5rem; min-width:4.5rem; }
    }
    /* Formulario del panel de alta (drawer estrecho) → una columna, no en fila. */
    .form { display:flex; flex-direction:column; gap:.7rem; }
    .form ion-button { align-self:flex-end; }
    /* Reprogramar: el profesional es contexto (no se edita aquí) y las dos salidas van juntas. */
    .form .ctx { margin:0; font-size:.9rem; color: var(--ion-color-medium, #92949c); }
    .form .actions { display:flex; gap:.5rem; justify-content:flex-end; align-items:center; }
    .form .actions ion-button { align-self:auto; }
    .err { color:#d9480f; font-weight:600; }
  `;
  }
  statusLabel(status) {
    const key = STATUS_KEYS2[status];
    return key ? erplora3().t(CATALOG3, key) : status;
  }
  /** Profesionales que pueden recibir citas: los que el módulo `staff` marca reservables. */
  get bookableStaff() {
    return this.staffMembers.filter((m4) => Number(m4.is_bookable) === 1 && m4.status !== "terminated");
  }
  get selectedService() {
    return this.services.find((s5) => s5.id === this.newServiceId);
  }
  /** Duración efectiva: la tecleada manda; si no, la del servicio; si no, la de los ajustes. */
  get effectiveDuration() {
    const typed = Number(this.newDuration);
    if (Number.isFinite(typed) && typed >= 1) return typed;
    const fromService = Number(this.selectedService?.duration_minutes);
    if (Number.isFinite(fromService) && fromService >= 1) return fromService;
    const fromSettings = Number(this.settings.default_duration);
    return Number.isFinite(fromSettings) && fromSettings >= 1 ? fromSettings : 60;
  }
  /** appointments#75: elegir servicio PRERRELLENA «Min.» con su duración de catálogo. La
   *  pantalla ya la sabía (viajaba en el payload) pero el campo quedaba VACÍO con el número
   *  solo como placeholder: la recepcionista no veía cuánto iba a durar la reserva, así que
   *  no podía detectar un catálogo mal puesto ni ajustar a ojo. El servicio ES la duración
   *  (Fresha, Vagaro, Square Appointments, Booksy); lo que se teclea es la excepción — y
   *  cambiar de servicio re-llena desde el nuevo, porque la excepción era del anterior. */
  onServiceChange(serviceId) {
    this.newServiceId = serviceId;
    const fromCatalogue = Number(this.services.find((s5) => s5.id === serviceId)?.duration_minutes);
    this.newDuration = Number.isFinite(fromCatalogue) && fromCatalogue >= 1 ? String(fromCatalogue) : "";
  }
  // Getters (no campos): se re-evalúan en cada render para seguir el idioma activo.
  get columns() {
    const t5 = (k2) => erplora3().t(CATALOG3, k2);
    return [
      { key: "start_datetime", header: t5("ui.colTime"), format: (r6) => fmtTime(r6.start_datetime) },
      { key: "appointment_number", header: t5("ui.colNumber") },
      { key: "customer_name", header: t5("ui.colCustomer") },
      { key: "service_name", header: t5("ui.colService") },
      { key: "staff_name", header: t5("ui.colStaff"), format: (r6) => r6.staff_name || "\u2014" },
      {
        key: "status",
        header: t5("ui.colStatus"),
        format: (r6) => this.statusLabel(r6.status)
      }
    ];
  }
  get rowActions() {
    const t5 = (k2) => erplora3().t(CATALOG3, k2);
    return [
      // COBRAR (sales#89): el eslabón que faltaba. La agenda sabía completar una cita y ahí se
      // acababa el camino; en un salón el servicio ES la venta.
      //
      // Una cita ya convertida se pinta DESHABILITADA, no se esconde: cobrar dos veces a la misma
      // clienta es el fallo a evitar, pero un botón que desaparece deja al mostrador sin saber por
      // qué. `converted_sale_id` lo escribe el listener de `sales.sale.created_from_appointment`.
      {
        id: "charge",
        label: t5("ui.actionCharge"),
        icon: "cash-outline",
        color: "success",
        disabled: (row) => !!row.converted_sale_id
      },
      // REPROGRAMAR (appointments#42): sin este gesto, mover una cita obligaba a cancelarla y
      // crearla de nuevo — la cita perdía su número, su identidad y su historial, y a la clienta
      // le quedaba en la ficha una cancelación que nunca pidió. El command ya existía.
      //
      // Fuera de pending|confirmed se pinta gris: es lo que acepta el handler de `reschedule`.
      {
        id: "reschedule",
        label: t5("ui.actionReschedule"),
        icon: "calendar-outline",
        color: "primary",
        disabled: (row) => !RESCHEDULABLE.includes(String(row.status))
      },
      { id: "confirm", label: t5("ui.actionConfirm"), icon: "checkmark-circle-outline", color: "success" },
      { id: "start", label: t5("ui.actionStart"), icon: "play-circle-outline", color: "primary" },
      { id: "complete", label: t5("ui.actionComplete"), icon: "checkmark-done-outline", color: "success" },
      // El no-show existía en la API desde el día 1 pero no en la barra: la recepcionista no
      // tenía forma de registrar que la clienta no vino (appointments#21).
      { id: "no_show", label: t5("ui.actionNoShow"), icon: "person-remove-outline", color: "warning" },
      { id: "cancel", label: t5("ui.actionCancel"), icon: "close-circle-outline", color: "danger" },
      { id: "delete", label: t5("ui.actionDelete"), icon: "trash-outline", color: "danger" }
    ];
  }
  /** Carriles del timeline: un profesional reservable por fila + el carril «sin asignar», que
   *  se pinta SIEMPRE para que ninguna cita heredada (sin `staff_id`) quede invisible. */
  get schedulerResources() {
    return [
      ...this.bookableStaff.map((m4) => ({ id: m4.id, label: m4.full_name })),
      { id: UNASSIGNED, label: erplora3().t(CATALOG3, "ui.unassigned") }
    ];
  }
  get schedulerEvents() {
    return this.items.map((a3) => ({
      id: a3.id,
      resourceId: a3.staff_id || UNASSIGNED,
      start: wallClock(a3.start_datetime),
      end: wallClock(a3.end_datetime),
      title: [a3.customer_name, a3.service_name].filter(Boolean).join(" \xB7 "),
      color: STATUS_COLORS[a3.status]
    }));
  }
  // TODO-LIT: componentWillLoad → connectedCallback. Recuerda: connectedCallback se dispara
  // en CADA reconexión al DOM (no solo en el primer montaje). Si la init debe correr una
  // sola vez tras el primer render, considera firstUpdated() en su lugar.
  async connectedCallback() {
    super.connectedCallback();
    window.addEventListener("erplora:locale-changed", this.onLocaleChange);
    await this.refresh();
    await this.loadCatalogs();
    try {
      const offs = [
        erplora3().on("appointments.appointment.created", () => this.refresh()),
        erplora3().on("appointments.appointment.updated", () => this.refresh()),
        erplora3().on("appointments.appointment.confirmed", () => this.refresh()),
        erplora3().on("appointments.appointment.started", () => this.refresh()),
        erplora3().on("appointments.appointment.completed", () => this.refresh()),
        erplora3().on("appointments.appointment.cancelled", () => this.refresh()),
        erplora3().on("appointments.appointment.no_show", () => this.refresh()),
        erplora3().on("appointments.appointment.rescheduled", () => this.refresh()),
        erplora3().on("appointments.appointment.deleted", () => this.refresh())
      ];
      this.unsub = () => offs.forEach((off) => off());
    } catch {
    }
  }
  disconnectedCallback() {
    window.removeEventListener("erplora:locale-changed", this.onLocaleChange);
    super.disconnectedCallback();
    this.unsub?.();
    this.settleOverlap(false);
  }
  /** Catálogos ligados + ajustes. Se cargan una vez: el alta reserva contra registros reales
   *  (`customers` / `services` / `staff`) vía sus queries PÚBLICAS — nunca sus tablas. */
  async loadCatalogs() {
    try {
      const [customers, services, staffMembers, settings] = await Promise.all([
        erplora3().query("customers.list", { limit: 500, sort: "name", dir: "asc" }).catch(() => []),
        erplora3().query("services.services.list", { limit: 500 }).catch(() => []),
        erplora3().query("staff.members.list", { limit: 500 }).catch(() => []),
        erplora3().query("appointments.settings.get").catch(() => [])
      ]);
      this.customers = rows3(customers);
      this.services = rows3(services).filter((s5) => s5.is_bookable === void 0 || Number(s5.is_bookable) === 1);
      this.staffMembers = rows3(staffMembers);
      this.settings = rows3(settings)[0] ?? {};
    } catch (e5) {
      this.error = e5 instanceof Error ? e5.message : erplora3().t(CATALOG3, "ui.errLoadCatalogs");
    }
  }
  /** Un día atrás o adelante (appointments#93). Aritmética de CALENDARIO: el día del salón dura
   *  23, 24 o 25 horas, así que «mañana» es la fecha siguiente, nunca `+24 h`. */
  stepDay(delta) {
    this.day = addDaysISO(this.day, delta);
    void this.refresh();
  }
  async refresh() {
    this.loading = true;
    this.error = "";
    try {
      const { day_start, day_end } = dayBounds(this.day);
      const result = await erplora3().query("appointments.appointments.list", {
        day_start,
        day_end,
        status: this.statusFilter,
        staff_id: "",
        limit: 100
      });
      this.items = rows3(result);
    } catch (e5) {
      this.error = e5 instanceof Error ? e5.message : erplora3().t(CATALOG3, "ui.errLoad");
    } finally {
      this.loading = false;
    }
  }
  // Referencia al ok-data-table para abrir/cerrar su panel lateral (el «+» de su barra).
  dataTable() {
    return this.renderRoot.querySelector("ok-data-table");
  }
  /** Has the chosen time already passed? Asked against the SALON clock, which is the one that
   *  decides (appointments#12/#76): the device may sit in another timezone and the answer would
   *  change with it. This is a warning, not a gate — the hub decides whether it is stored, and
   *  since appointments#155 it says yes. A half-typed time is not an instant: warn about nothing. */
  get newStartIsPast() {
    if (!this.newStart) return false;
    try {
      return new Date(wallToBusinessIso(this.newStart)).getTime() < Date.now();
    } catch {
      return false;
    }
  }
  async createAppointment(ev) {
    ev.preventDefault();
    const customer = this.customers.find((c5) => c5.id === this.newCustomerId);
    const service = this.selectedService;
    const staff = this.bookableStaff.find((m4) => m4.id === this.newStaffId);
    if (!customer || !service || !staff || !this.newStart) return;
    this.saving = true;
    this.error = "";
    this.formError = "";
    try {
      const startIso = wallToBusinessIso(this.newStart);
      if (!await this.overlapAccepted(startIso, this.effectiveDuration, staff.id)) return;
      await erplora3().command("appointments.appointments.create", {
        // Vínculos + su snapshot denormalizado (lo que se reservó, aunque la ficha cambie).
        customer_id: customer.id,
        customer_name: customer.name,
        customer_phone: customer.phone ?? "",
        customer_email: customer.email ?? "",
        service_id: service.id,
        service_name: service.name,
        service_price: Number(service.price) || 0,
        staff_id: staff.id,
        staff_name: staff.full_name,
        start_datetime: startIso,
        duration_minutes: this.effectiveDuration,
        // appointments#155 — the COUNTER's declaration. This form IS the counter: a person with
        // the agenda in front of them has just read the warning above, so they may book the
        // walk-in already sitting in the chair. Sent ALWAYS, and deliberately without consulting
        // the browser clock: the deciding clock is the hub's, and one second of drift would bring
        // back the silent refusal this issue is about. It only excuses the past — a future time is
        // still judged by `min_booking_notice`. The other doors (inbox, batch, series) never send
        // it.
        allow_past: true
      });
      this.newCustomerId = "";
      this.newServiceId = "";
      this.newStaffId = "";
      this.newStart = "";
      this.newDuration = "";
      this.dataTable()?.close();
      await this.refresh();
    } catch (e5) {
      this.formError = domainErrorText(e5, "ui.errCreate");
      erplora3().notify?.({ type: "error", message: this.formError });
    } finally {
      this.saving = false;
    }
  }
  // ── Aviso de SOLAPE (appointments#86) ───────────────────────────────────────────────────────
  //
  // Lo que decidió el mercado, y es unánime en las cinco referencias del sector (Phorest, Square
  // Appointments, DaySmart/Salon Iris, Fresha, Vagaro): **el solape se CONFIRMA, no se asume**. Con
  // el toggle apagado el rechazo duro ya existía (`_appointment_overlap_assert.sql`); lo que
  // faltaba era el paso intermedio del caso PERMITIDO, donde hoy la cita se creaba en silencio.
  // ADR-0383 lo dejó fuera del componente a propósito: `ok-scheduler` pinta el solape bien, pero
  // no sabe —ni debe— de reglas de negocio. El aviso es del módulo.
  //
  // 🔴 Lo que NO pregunta, y por qué:
  //  · `appointments._book_from_request` (el listener de `whatsapp_inbox.request.approved`) corre
  //    en el servidor y no tiene a quién preguntar. Su confirmación humana YA ocurrió —alguien
  //    aprobó la petición en la bandeja, sobre huecos que `availability.slots` había ofrecido— así
  //    que reserva directamente, con el mismo gate de servidor que el resto. Un aviso ahí sería
  //    una pregunta sin interlocutor que dejaría la petición aprobada sin cita.
  //  · Mover una SERIE entera (`recurring.update`, alcance «esta y las siguientes») no es un hueco:
  //    son N ocurrencias que el servidor recoloca. Queda fuera con su issue.
  /** ¿Permite este hub dos citas a la vez? El flag viaja como booleano JSON (appointments#79),
   *  pero una fila vieja puede seguir contestando 0/1: las dos formas se leen igual. */
  get allowsOverlapping() {
    const flag = this.settings.allow_overlapping;
    return flag === true || Number(flag) === 1;
  }
  /** Citas vivas del mismo profesional que pisan `[start, start+minutes)`.
   *
   *  Se lee la query PÚBLICA del módulo (`appointments.appointments.conflicting`, la misma que el
   *  runtime precarga para el handler de `create`) y no `this.items`: el hueco elegido puede caer
   *  en otro día del que la agenda tiene cargado, y avisar solo de lo que está en pantalla sería
   *  un aviso que falla justo cuando hace falta. El filtrado fino por ventana es de aquí, igual
   *  que en el handler: la query trae el día entero porque `reads.params` solo admite literales. */
  async overlappingWith(startIso, minutes, staffId, excludeId = "") {
    const from = toInstantMs(startIso);
    if (from === null || !Number.isFinite(minutes) || minutes < 1) return [];
    const to = from + minutes * 6e4;
    const found = await erplora3().query("appointments.appointments.conflicting", {
      staff_id: staffId,
      start_datetime: startIso
    });
    return rows3(found).filter((a3) => {
      if (a3.id === excludeId) return false;
      const s5 = toInstantMs(a3.start_datetime);
      const e5 = toInstantMs(a3.end_datetime);
      return s5 !== null && e5 !== null && s5 < to && e5 > from;
    });
  }
  /** Pinta el aviso y espera. La promesa la resuelven los botones del `ion-alert`. */
  askOverlap(conflicts) {
    const t5 = (k2, p4) => erplora3().t(CATALOG3, k2, p4);
    const list = conflicts.map((a3) => `${a3.customer_name || t5("ui.colCustomer")} \xB7 ${fmtTime(a3.start_datetime)}`).join(", ");
    return new Promise((resolve) => {
      this.overlapPrompt = t5("ui.overlapMessage", { conflicts: list });
      this.overlapDecision = resolve;
    });
  }
  /** «Reservar igual». */
  confirmOverlap() {
    this.settleOverlap(true);
  }
  /** «Elegir otra hora»: no se escribe nada y lo tecleado sigue en el panel. */
  cancelOverlap() {
    this.settleOverlap(false);
  }
  settleOverlap(accepted) {
    const decide = this.overlapDecision;
    this.overlapDecision = null;
    this.overlapPrompt = "";
    decide?.(accepted);
  }
  /** La puerta que cruzan `create`, `reschedule` y el arrastre. `true` = se puede escribir.
   *
   *  Con el toggle APAGADO no pregunta nada: el servidor rechaza, y ofrecer un «reservar igual»
   *  que siempre va a fallar es peor que no ofrecerlo. Si la lectura de la agenda falla, la reserva
   *  NO se pierde —el aviso es consejo, no cerradura— pero el fallo se DICE: una comprobación que
   *  se cae en silencio es la que hace creer que no había solape. */
  async overlapAccepted(startIso, minutes, staffId, excludeId = "") {
    if (!this.allowsOverlapping) return true;
    let conflicts;
    try {
      conflicts = await this.overlappingWith(startIso, minutes, staffId, excludeId);
    } catch {
      erplora3().notify?.({ type: "warning", message: erplora3().t(CATALOG3, "ui.errOverlapCheck") });
      return true;
    }
    if (conflicts.length === 0) return true;
    return this.askOverlap(conflicts);
  }
  /** Manda al shell a la pantalla de venta con la cita cargada.
   *
   *  Un Web Component no recibe el router: el único canal de navegación módulo→shell es empujar la
   *  URL y avisar con `popstate`, que es el patrón que ya usa `verifactu`. El id viaja por query
   *  string y el TPV lo consume y lo borra. */
  goToTill(appointmentId) {
    window.history.pushState({}, "", `/m/sales/pos?appointment_id=${encodeURIComponent(appointmentId)}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
  async onRowAction(ev) {
    const { actionId, row } = ev.detail;
    const id = row.id;
    this.error = "";
    try {
      switch (actionId) {
        // ADR-0077: COBRAR es trabajo del TPV, no de la agenda. Aquí no se arma ninguna venta ni
        // se calcula ningún total: se le entrega el id de la cita y el TPV la lee por la query
        // pública de este módulo. `appointments` nunca aprende qué es una venta.
        case "charge":
          this.goToTill(id);
          return;
        // navegamos fuera: refrescar la agenda que abandonamos no tiene sentido
        case "reschedule":
          await this.openReschedule(row);
          return;
        // abre el panel; no hay nada que refrescar todavía
        case "confirm":
          await erplora3().command("appointments.appointments.confirm", { appointment_id: id });
          break;
        case "start":
          await erplora3().command("appointments.appointments.start", { appointment_id: id });
          break;
        case "complete":
          await erplora3().command("appointments.appointments.complete", { appointment_id: id });
          break;
        case "no_show":
          await erplora3().command("appointments.appointments.no_show", { appointment_id: id });
          break;
        case "cancel":
          await erplora3().command("appointments.appointments.cancel", { appointment_id: id, reason: "" });
          break;
        case "delete":
          await erplora3().command("appointments.appointments.delete", { appointment_id: id });
          break;
      }
      await this.refresh();
    } catch (e5) {
      this.error = domainErrorText(e5, "ui.errAction");
    }
  }
  /** Abre el panel en modo ALTA, limpiando cualquier reprogramación a medias.
   *
   *  El «+» de la barra lo despacha el módulo (`primaryAction`) en vez de dejárselo a `addable`,
   *  precisamente por esto: el panel es uno solo y con `addable` la tabla lo abría por su cuenta,
   *  así que cerrar un «reprogramar» con el scrim y pulsar «+» a continuación te devolvía el
   *  formulario de mover la cita anterior. */
  async openCreate() {
    this.clearReschedule();
    await this.updateComplete;
    this.dataTable()?.open("create");
  }
  clearReschedule() {
    this.formError = "";
    this.rescheduleId = "";
    this.rescheduleStart = "";
    this.rescheduleDuration = "";
    this.rescheduleStaffName = "";
    this.rescheduleStaffId = "";
    this.rescheduleSeriesId = "";
    this.rescheduleOccurrence = "";
    this.askingSeriesScope = false;
    this.seriesScope = "this_only";
  }
  /** Abre el panel pre-rellenado con la cita que se va a mover. La fila manda: no se re-teclea
   *  nada que ya esté guardado. Fuera de pending|confirmed no se abre — el command lo rechazaría
   *  y el panel habría prometido algo que no puede cumplir. */
  async openReschedule(row) {
    if (!RESCHEDULABLE.includes(String(row.status))) return;
    this.rescheduleId = String(row.id ?? "");
    this.rescheduleStart = toInputValue(String(row.start_datetime ?? ""));
    this.rescheduleDuration = String(row.duration_minutes ?? "");
    this.rescheduleStaffName = String(row.staff_name ?? "");
    this.rescheduleStaffId = String(row.staff_id ?? "");
    this.rescheduleSeriesId = String(row.recurring_id ?? "");
    this.rescheduleOccurrence = String(row.occurrence_date ?? "");
    this.error = "";
    this.view = "list";
    await this.updateComplete;
    this.dataTable()?.open("create");
  }
  /** Bloque del timeline → mismo panel pre-rellenado.
   *
   *  El ARRASTRE (appointments#74, `onEventMove`) es la mitad rápida del gesto; el clic es la
   *  mitad accesible —la ruta de teclado que `ok-scheduler` expone como botón enfocable— y en
   *  una tablet cuesta el mismo toque. Las dos llegan al mismo command. */
  async onEventClick(ev) {
    const row = this.items.find((a3) => a3.id === ev.detail.id);
    if (row) await this.openReschedule(row);
  }
  /** Arrastre del timeline (appointments#74): `ok-scheduler` pinta el bloque en su destino y
   *  pregunta; EL MÓDULO MANDA. La rejilla ya trae el gesto (outfitkit#64: puntero, y dedo tras
   *  una pulsación mantenida —el estándar del sector contra el arrastre accidental en tablet—,
   *  más las flechas de teclado), pero sin un host que escuche y persista, mover sería mentir.
   *
   *  Lo que NO hace este cableado, a propósito:
   *  · CAMBIAR DE PROFESIONAL. Soltar el bloque en otro carril ES un cambio de profesional, y
   *    `reschedule` mueve la hora nada más (appointments#11 sacó la identidad del profesional
   *    de las manos del llamante). Dejarlo «medio funcionar» guardaría la hora y enseñaría el
   *    carril: una mentira en la agenda. Se rechaza con un aviso claro y `revert()`.
   *  · CONFIRMAR LIGERO al soltar (el diálogo con «avisar a la clienta» de Vagaro/Fresha).
   *    Necesita un canal de notificación que este módulo no tiene; la reprogramación queda
   *    visible en la agenda refrescada y con su historial (`_history_reschedule`).
   *
   *  El rechazo del servidor (solape, bloqueo, antelación, estado terminal) llama `revert()`
   *  —el bloque vuelve a su sitio en vez de quedarse donde el servidor nunca lo aceptó— y el
   *  fallo se ve DOS veces: toast del shell (el arrastre pasa lejos del banner) y el
   *  `ok-inline-feedback` de siempre. */
  async onEventMove(ev) {
    const { id, resourceId, start, revert } = ev.detail;
    const appointment = this.items.find((a3) => a3.id === id);
    if (!appointment) {
      revert();
      return;
    }
    const lane = appointment.staff_id || UNASSIGNED;
    if (!RESCHEDULABLE.includes(appointment.status)) {
      revert();
      this.refuseDrag("ui.errDragNotMovable");
      return;
    }
    if (resourceId !== lane) {
      revert();
      this.refuseDrag("ui.errDragStaffChange");
      return;
    }
    try {
      const startIso = wallToBusinessIso(`${this.day}T${start}`);
      if (!await this.overlapAccepted(
        startIso,
        appointment.duration_minutes,
        appointment.staff_id || "",
        id
      )) {
        revert();
        return;
      }
      await erplora3().command("appointments.appointments.reschedule", {
        appointment_id: id,
        start_datetime: startIso,
        duration_minutes: appointment.duration_minutes
      });
      await this.refresh();
    } catch (e5) {
      revert();
      this.error = domainErrorText(e5, "ui.errReschedule");
      erplora3().notify?.({ type: "error", message: this.error });
    }
  }
  /** Rechazo local del arrastre: el bloque ya ha vuelto (`revert()`), queda DECIR por qué. */
  refuseDrag(key) {
    this.error = erplora3().t(CATALOG3, key);
    erplora3().notify?.({ type: "error", message: this.error });
  }
  /** Mueve la cita. Solo viajan las TRES claves del esquema
   *  (`schemas/appointment_reschedule.json` es `additionalProperties: false`: una clave de más
   *  y el payload entero se rechaza).
   *
   *  `end_datetime` ya NO se manda (appointments#10): el fin es aritmética —inicio + duración— y
   *  la hace el handler. Mandarlo desde aquí era una segunda opinión que podía no cuadrar con la
   *  duración, y nadie podía explicar la fila resultante.
   *
   *  El profesional NO se cambia aquí: mandarle un `staff_id` desde el navegador devolvería la
   *  identidad del profesional al llamante, que es justo lo que appointments#11 le quitó al alta.
   *  El handler lo lee de la fila de la cita. Cambiar de profesional es trabajo aparte. */
  async submitReschedule(ev) {
    ev.preventDefault();
    if (!this.rescheduleId || !this.rescheduleStart) return;
    const minutes = Math.trunc(Number(this.rescheduleDuration));
    if (!Number.isFinite(minutes) || minutes < 1) return;
    if (this.rescheduleSeriesId && this.rescheduleOccurrence) {
      this.seriesScope = "this_only";
      this.askingSeriesScope = true;
      return;
    }
    await this.applyReschedule("this_only");
  }
  /** La recepcionista ha contestado la pregunta del alcance. */
  async confirmSeriesScope() {
    const scope = this.seriesScope;
    this.askingSeriesScope = false;
    await this.applyReschedule(scope);
  }
  /** Se echa atrás: no se escribe nada y lo tecleado sigue ahí — elige otra vez, no desde cero. */
  cancelSeriesScope() {
    this.askingSeriesScope = false;
  }
  /** Escribe el movimiento con el alcance elegido.
   *
   *  `this_only` mueve UNA cita, que es lo que esta pantalla hacía siempre. `this_and_following`
   *  es otro command: parte la serie en dos y arrastra las ocurrencias futuras — el trabajo vive
   *  en el servidor, porque decidir cuáles se mueven exige saber cuáles están canceladas y cuáles
   *  ya se cobraron, y eso no se le pregunta al navegador. */
  async applyReschedule(scope) {
    const minutes = Math.trunc(Number(this.rescheduleDuration));
    this.saving = true;
    this.error = "";
    try {
      if (scope === "this_and_following") {
        await erplora3().command("appointments.recurring.update", {
          recurring_id: this.rescheduleSeriesId,
          scope,
          from_occurrence_date: this.rescheduleOccurrence,
          // HORA DE PARED, no un instante: la hora de una plantilla es una lectura de reloj y no
          // se guarda convertida (appointments#12). El servidor la sitúa en la zona del negocio
          // día a día, que es lo que conserva la hora al cruzar el cambio de hora.
          time: this.rescheduleStart.slice(11, 16),
          duration_minutes: minutes
        });
      } else {
        const startIso = wallToBusinessIso(this.rescheduleStart);
        if (!await this.overlapAccepted(startIso, minutes, this.rescheduleStaffId, this.rescheduleId)) {
          return;
        }
        await erplora3().command("appointments.appointments.reschedule", {
          appointment_id: this.rescheduleId,
          start_datetime: startIso,
          duration_minutes: minutes
        });
      }
      this.clearReschedule();
      this.dataTable()?.close();
      await this.refresh();
    } catch (e5) {
      this.error = domainErrorText(e5, "ui.errReschedule");
    } finally {
      this.saving = false;
    }
  }
  /** Hueco libre del timeline → se pre-rellena el alta con ESE profesional y ESA hora y se
   *  vuelve a la lista, donde vive el panel del «+». Reservar tocando el hueco es el gesto
   *  estándar de una agenda de salón. */
  async onSlotClick(ev) {
    const { resourceId, time } = ev.detail;
    this.clearReschedule();
    if (resourceId !== UNASSIGNED) this.newStaffId = resourceId;
    this.newStart = `${this.day}T${time}`;
    this.view = "list";
    await this.updateComplete;
    this.dataTable()?.open("create");
  }
  // El título de la vista lo pinta el topbar del shell: repetirlo aquí lo duplicaba en pantalla.
  render() {
    const t5 = (k2) => erplora3().t(CATALOG3, k2);
    const startHour = Number(this.settings.calendar_start_hour ?? 8);
    const endHour = Number(this.settings.calendar_end_hour ?? 20);
    return b2`<div class="page">
        <!-- Día y estado NO son filtros de columna: son el ALCANCE de la consulta (los binds
             day_start/day_end/status de appointments.appointments.list, que no es una lista
             paginada del motor). Deciden QUÉ se carga → viven fuera del embudo de la tabla.
             El conmutador de vista (lista | por profesional) vive aquí por lo mismo: decide
             CÓMO se pinta lo cargado, no filtra columnas. -->
        <div class="filters">
          ${this.view === "series" ? A : b2`<!-- appointments#93 · el día se PASA, no solo se teclea. Es el gesto de toda agenda de
               salón (Fresha, Vagaro, Square, Google Calendar) y además cierra una asimetría que ya
               había: la vista por profesional podía cambiar de día con las flechas de ok-scheduler
               y la lista no. Sin etiqueta flotante: en un móvil son ~20 px de alto para decir
               «Día» encima de una fecha, y el nombre accesible viaja en aria-label. -->
          <div class="daynav">
            <ion-button data-testid="appointments-list-prev-day" data-role="prev-day" fill="clear" aria-label=${t5("ui.prevDay")} @click=${() => this.stepDay(-1)}>
              <ion-icon slot="icon-only" name="chevron-back-outline"></ion-icon>
            </ion-button>
            <ion-input data-testid="appointments-list-day" data-role="day" aria-label=${t5("ui.fieldDate")} type="date" .value=${this.day} @ionInput=${(e5) => {
      this.day = e5.target.value;
      this.refresh();
    }}></ion-input>
            <ion-button data-testid="appointments-list-next-day" data-role="next-day" fill="clear" aria-label=${t5("ui.nextDay")} @click=${() => this.stepDay(1)}>
              <ion-icon slot="icon-only" name="chevron-forward-outline"></ion-icon>
            </ion-button>
          </div>
          <ion-select data-testid="appointments-list-status-filter" data-role="status" aria-label=${t5("ui.filterStatus")} placeholder=${t5("ui.allStatuses")} .value=${this.statusFilter} @ionChange=${(e5) => {
      this.statusFilter = e5.target.value;
      this.refresh();
    }}>
            <ion-select-option value="">${t5("ui.statusAll")}</ion-select-option>
            ${Object.keys(STATUS_KEYS2).map((k2) => b2`<ion-select-option .value=${k2}>${this.statusLabel(k2)}</ion-select-option>`)}
          </ion-select>`}
          <!-- El día y el estado son el ALCANCE de la consulta de la agenda; en la vista de series
               no filtran nada, así que se retiran en vez de quedarse prometiendo un filtro que no
               existe. El conmutador se queda: es lo único que sigue significando lo mismo. -->
          <ion-segment data-testid="appointments-list-view" .value=${this.view} @ionChange=${(e5) => this.view = e5.target.value}>
            <ion-segment-button data-testid="appointments-list-view-list" value="list" aria-label=${t5("ui.viewList")}>
              <ion-icon name="list-outline"></ion-icon>
              <ion-label>${t5("ui.viewList")}</ion-label>
            </ion-segment-button>
            <ion-segment-button data-testid="appointments-list-view-staff" value="staff" aria-label=${t5("ui.viewStaff")}>
              <ion-icon name="people-outline"></ion-icon>
              <ion-label>${t5("ui.viewStaff")}</ion-label>
            </ion-segment-button>
            <!-- appointments#91: la tercera puerta. Sin ella una serie sin ocurrencias
                 materializadas no tiene NINGUNA fila desde la que abrirse. -->
            <ion-segment-button data-testid="appointments-list-view-series" value="series" aria-label=${t5("ui.viewSeries")}>
              <ion-icon name="repeat-outline"></ion-icon>
              <ion-label>${t5("ui.viewSeries")}</ion-label>
            </ion-segment-button>
          </ion-segment>
        </div>
        <!-- appointments#12: el aparato NO manda, pero tampoco se le engaña en silencio. Si el
             tablet está en otra zona, la agenda sigue pintando el reloj del NEGOCIO y lo dice —
             el patrón que Square acabó adoptando tras años de citas movidas por el huso del
             dispositivo. Con los dos relojes de acuerdo no se pinta nada: un aviso permanente es
             un aviso que nadie lee. -->
        ${deviceZoneDiffers() ? b2`<ok-inline-feedback data-testid="appointments-list-device-zone-notice" tone="warning" icon="globe-outline"
              >${t5("ui.deviceZoneNotice")} ${businessTimezone()}</ok-inline-feedback
            >` : A}
        ${this.error ? b2`<ok-inline-feedback data-testid="appointments-list-error" tone="danger" icon="alert-circle-outline">${this.error}</ok-inline-feedback>` : A}
        <!-- appointments#15 — la pregunta del ALCANCE. Radios en un alert y no una action sheet
             (que es más nativa en móvil) por una razón concreta: la action sheet no puede llevar
             el AVISO de qué se va a pisar, y ese aviso es el contrato entero de la decisión. El
             botón primario nombra la acción; «OK» no dice qué va a pasar. -->
        ${this.askingSeriesScope ? b2`<ion-alert
              data-testid="appointments-list-series-scope"
              .isOpen=${true}
              .header=${t5("ui.seriesScopeTitle")}
              .message=${`${t5("ui.seriesScopeMessage")} ${t5("ui.seriesScopeMoved")} ${t5("ui.seriesScopeCancelledKept")}`}
              .inputs=${[
      {
        type: "radio",
        label: t5("ui.seriesScopeThisOnly"),
        value: "this_only",
        checked: this.seriesScope === "this_only",
        handler: () => this.seriesScope = "this_only"
      },
      {
        type: "radio",
        label: t5("ui.seriesScopeFollowing"),
        value: "this_and_following",
        checked: this.seriesScope === "this_and_following",
        handler: () => this.seriesScope = "this_and_following"
      }
    ]}
              .buttons=${[
      { text: t5("ui.cancelReschedule"), role: "cancel", handler: () => this.cancelSeriesScope() },
      { text: t5("ui.seriesScopeConfirm"), handler: () => this.confirmSeriesScope() }
    ]}
              @ionAlertDidDismiss=${() => this.cancelSeriesScope()}
            ></ion-alert>` : A}
        <!-- appointments#86 — el aviso de SOLAPE. Alert y no toast: un toast se va solo, y esto es
             una decisión que hay que tomar antes de escribir. El botón primario NOMBRA lo que va a
             pasar («Reservar igual»), y el de salida ofrece la alternativa real («Elegir otra
             hora») en vez de un «Cancelar» que no dice qué queda después. -->
        ${this.overlapPrompt ? b2`<ion-alert
              data-testid="appointments-list-overlap-confirm"
              data-role="overlap-confirm"
              .isOpen=${true}
              .header=${t5("ui.overlapTitle")}
              .message=${this.overlapPrompt}
              .buttons=${[
      { text: t5("ui.overlapCancel"), role: "cancel", handler: () => this.cancelOverlap() },
      { text: t5("ui.overlapConfirm"), handler: () => this.confirmOverlap() }
    ]}
              @ionAlertDidDismiss=${() => this.cancelOverlap()}
            ></ion-alert>` : A}
        ${this.view === "series" ? b2`<erp-appointments-series></erp-appointments-series>` : this.view === "staff" ? b2`<ok-scheduler
              .date=${this.day}
              .startHour=${startHour}
              .endHour=${endHour}
              .locale=${erplora3().locale || "es"}
              .resources=${this.schedulerResources}
              .events=${this.schedulerEvents}
              movable
              snap-minutes="15"
              .labels=${{ prevDay: t5("ui.prevDay"), nextDay: t5("ui.nextDay"), empty: t5("ui.noStaff") }}
              @ok-nav=${(e5) => {
      this.day = e5.detail.date;
      this.refresh();
    }}
              @ok-slot-click=${(e5) => this.onSlotClick(e5)}
              @ok-event-click=${(e5) => this.onEventClick(e5)}
              @ok-event-move=${(e5) => this.onEventMove(e5)}
            ></ok-scheduler>` : b2`<ok-data-table testid="appointments-list-table" .fill=${true} .primaryAction=${{ label: t5("ui.addAppointment"), icon: "add" }} @primaryAction=${() => this.openCreate()} .labels=${this.rescheduleId ? { newRecord: t5("ui.rescheduleTitle") } : {}} .views=${true} .cardTitle=${(row) => String(row.appointment_number ?? row.customer_name ?? "")} .columns=${this.columns} .rows=${this.items} .searchKeys=${["appointment_number", "customer_name", "service_name", "staff_name"]} .searchPlaceholder=${t5("ui.searchPlaceholder")} .actions=${this.rowActions} @rowAction=${(e5) => this.onRowAction(e5)} .emptyMessage=${this.loading ? t5("ui.loading") : t5("ui.empty")}>
          <!-- El panel es UNO: alta si no hay cita en curso, mover si la hay (appointments#42). -->
          ${this.rescheduleId ? this.renderRescheduleForm(t5) : this.renderCreateForm(t5)}
        </ok-data-table>`}
      </div>`;
  }
  /** Mover la cita: solo el hueco. Cliente y servicio no se pintan porque `reschedule` no los
   *  toca — enseñarlos editables prometería un cambio que el command descarta. */
  renderRescheduleForm(t5) {
    return b2`<form slot="create" data-testid="appointments-list-reschedule-form" data-mode="reschedule" class="form" @submit=${(e5) => this.submitReschedule(e5)}>
      <ok-inline-feedback data-testid="appointments-list-reschedule-hint" tone="info" icon="information-circle-outline">${t5("ui.rescheduleHint")}</ok-inline-feedback>
      <p class="ctx">${t5("ui.fieldStaff")}: <strong>${this.rescheduleStaffName || "\u2014"}</strong></p>
      <ion-input data-testid="appointments-list-reschedule-start" data-role="reschedule-start" fill="outline" label-placement="floating" label=${t5("ui.fieldStart")} type="datetime-local" .value=${this.rescheduleStart} @ionInput=${(e5) => this.rescheduleStart = e5.target.value}></ion-input>
      <ion-input data-testid="appointments-list-reschedule-duration" data-role="reschedule-duration" fill="outline" label-placement="floating" label=${t5("ui.fieldMinutes")} type="number" min="1" .value=${this.rescheduleDuration} @ionInput=${(e5) => this.rescheduleDuration = e5.target.value}></ion-input>
      <div class="actions">
        <ion-button data-testid="appointments-list-reschedule-cancel" type="button" size="small" fill="clear" @click=${() => {
      this.clearReschedule();
      this.dataTable()?.close();
    }}>${t5("ui.cancelReschedule")}</ion-button>
        <ion-button data-testid="appointments-list-reschedule-submit" type="submit" size="small" ?disabled=${this.saving || !this.rescheduleStart || !this.rescheduleDuration}>${this.saving ? t5("ui.saving") : t5("ui.confirmReschedule")}</ion-button>
      </div>
    </form>`;
  }
  /** Alta de cita: se proyecta SIEMPRE (aunque el panel esté cerrado); si solo se pintara
   *  al abrirlo, el «+» desplegaría un panel vacío en el primer clic.
   *  Cliente, servicio y profesional se ELIGEN de sus módulos (appointments#21): con
   *  texto libre la cita no se podía agrupar por profesional, ni casar con la
   *  disponibilidad, ni pasar a la venta sin re-teclear. */
  renderCreateForm(t5) {
    return b2`<form slot="create" data-testid="appointments-list-form" data-mode="create" class="form" @submit=${(e5) => this.createAppointment(e5)}>
            <ion-select data-testid="appointments-list-customer" data-role="customer" fill="outline" label-placement="floating" label=${t5("ui.fieldCustomer")} placeholder=${t5("ui.pickCustomer")} .value=${this.newCustomerId} @ionChange=${(e5) => this.newCustomerId = e5.target.value}>
              ${this.customers.map((c5) => b2`<ion-select-option .value=${c5.id}>${c5.name}</ion-select-option>`)}
            </ion-select>
            <ion-select data-testid="appointments-list-service" data-role="service" fill="outline" label-placement="floating" label=${t5("ui.fieldService")} placeholder=${t5("ui.pickService")} .value=${this.newServiceId} @ionChange=${(e5) => this.onServiceChange(e5.target.value)}>
              ${this.services.map((s5) => b2`<ion-select-option .value=${s5.id}>${s5.name}</ion-select-option>`)}
            </ion-select>
            <ion-select data-testid="appointments-list-staff" data-role="staff" fill="outline" label-placement="floating" label=${t5("ui.fieldStaff")} placeholder=${t5("ui.pickStaff")} .value=${this.newStaffId} @ionChange=${(e5) => this.newStaffId = e5.target.value}>
              ${this.bookableStaff.map((m4) => b2`<ion-select-option .value=${m4.id}>${m4.full_name}</ion-select-option>`)}
            </ion-select>
            <ion-input data-testid="appointments-list-start" fill="outline" label-placement="floating" label=${t5("ui.fieldStart")} type="datetime-local" .value=${this.newStart} @ionInput=${(e5) => this.newStart = e5.target.value}></ion-input>
            <!-- Minutos se PRERRELLENA al elegir servicio (appointments#75): la duración que la
                 reserva va a tener tiene que estar EN PANTALLA; se teclea solo para excepciones
                 (una clienta que necesita más tiempo). -->
            <ion-input data-testid="appointments-list-duration" data-role="duration" fill="outline" label-placement="floating" label=${t5("ui.fieldMinutes")} type="number" min="1" .value=${this.newDuration} @ionInput=${(e5) => this.newDuration = e5.target.value}></ion-input>
            <!-- appointments#155 - the warning and the refusal, NEXT TO THE BUTTON. This is
                 where the person is looking; the list's inline feedback is covered by this very
                 panel. The past-start warning is informative (Acuity warns without blocking) and
                 is painted only once the chosen time has passed: a permanent notice goes unread. -->
            ${this.newStartIsPast ? b2`<ok-inline-feedback data-testid="appointments-list-past-start-notice" tone="warning" icon="time-outline">${t5("ui.pastStartNotice")}</ok-inline-feedback>` : A}
            ${this.formError ? b2`<ok-inline-feedback data-testid="appointments-list-form-error" tone="danger" icon="alert-circle-outline">${this.formError}</ok-inline-feedback>` : A}
            <ion-button data-testid="appointments-list-submit" type="submit" size="small" ?disabled=${this.saving || !this.newCustomerId || !this.newServiceId || !this.newStaffId || !this.newStart}>${this.saving ? t5("ui.saving") : t5("ui.addAppointment")}</ion-button>
          </form>`;
  }
};
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "items", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "loading", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "error", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "formError", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "saving", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "day", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "statusFilter", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "view", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "customers", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "services", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "staffMembers", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "settings", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "newCustomerId", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "newServiceId", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "newStaffId", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "newStart", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "newDuration", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "rescheduleId", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "rescheduleStart", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "rescheduleDuration", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "rescheduleStaffName", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "rescheduleStaffId", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "rescheduleSeriesId", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "rescheduleOccurrence", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "askingSeriesScope", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "seriesScope", 2);
__decorateClass([
  r5()
], ErpAppointmentsList.prototype, "overlapPrompt", 2);
define("erp-appointments-list", ErpAppointmentsList);

// ui/components/erp-appointments-request-booking/erp-appointments-request-booking.ts
var CATALOG4 = { es: es_default, en: en_default };
function erplora4() {
  const c5 = globalThis.erplora;
  if (!c5) throw new Error("erplora SDK not initialised by the shell");
  return c5;
}
function can(permission) {
  const client = erplora4();
  return typeof client.hasPermission === "function" ? client.hasPermission(permission) : true;
}
function rows4(r6) {
  if (Array.isArray(r6)) return r6;
  if (r6 && typeof r6 === "object" && Array.isArray(r6.rows)) return r6.rows;
  return [];
}
var today = todayISO;
var ErpAppointmentsRequestBooking = class extends i3 {
  constructor() {
    super(...arguments);
    this.open = null;
    this.services = [];
    this.staffMembers = [];
    this.matches = [];
    this.search = "";
    this.customerId = "";
    this.customerLabel = "";
    this.serviceId = "";
    this.staffId = "";
    this.date = today();
    this.slots = [];
    this.dayClosed = false;
    this.openingUnknown = false;
    this.startDatetime = "";
    this.busy = false;
    this.error = "";
    this.holdUntil = 0;
    this.holdLeft = 0;
    this.holdExpired = false;
    /** How long a hold lasts here, from the hub's settings (`hold_minutes`, 15 by default, 0 = off). */
    this.holdMinutes = 15;
    this.holdTicker = null;
    this.catalogsLoaded = false;
    this.onLocaleChange = () => this.requestUpdate();
    /** The host tells us which request is open. Same contract as `customers.detail`: an event on
     *  the element, never a prop and never a call — and it is re-announced on every host re-render,
     *  so opening the SAME request again must not wipe what the operator has already picked. */
    this.onOpen = (ev) => {
      const detail = ev.detail ?? {};
      const request = {
        request_id: String(detail.request_id ?? ""),
        request_type: String(detail.request_type ?? ""),
        customer_id: String(detail.customer_id ?? ""),
        contact_name: String(detail.contact_name ?? ""),
        contact_phone: String(detail.contact_phone ?? ""),
        raw_summary: String(detail.raw_summary ?? "")
      };
      if (this.open?.request_id === request.request_id) return;
      this.open = request;
      this.error = "";
      this.startDatetime = "";
      this.slots = [];
      this.holdUntil = 0;
      this.holdExpired = false;
      this.stopHoldClock();
      this.customerId = request.customer_id;
      this.customerLabel = request.customer_id ? request.contact_name : "";
      this.search = request.contact_phone || request.contact_name;
      void this.loadCatalogs();
      if (!this.customerId) void this.searchCustomers();
    };
  }
  static {
    this.styles = i`
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ion-text-color, #1c1b18); }
    .panel { display:flex; flex-direction:column; gap:.6rem; padding:.6rem 0; }
    label { display:block; font-size:.8rem; font-weight:600; margin-bottom:.2rem; }
    select, input { width:100%; min-height:44px; box-sizing:border-box; padding:.4rem .5rem;
      border:1px solid var(--ion-color-step-200, #d8d5d0); border-radius:.4rem;
      background: var(--ion-background-color, #fff); color: inherit; font: inherit; }
    .actions { display:flex; gap:.4rem; align-items:center; flex-wrap:wrap; }
    .slots { display:flex; flex-wrap:wrap; gap:.35rem; }
    .slot { min-height:44px; min-width:72px; padding:0 .7rem; border-radius:.4rem; cursor:pointer;
      border:1px solid var(--ion-color-step-200, #d8d5d0); background: var(--ion-background-color, #fff);
      color: inherit; font: inherit; }
    .slot[aria-pressed='true'] { border-color: var(--ion-color-primary, #3880ff); font-weight:700; }
    .matches { display:flex; flex-direction:column; gap:.25rem; margin-top:.3rem; }
    .match { text-align:left; min-height:44px; padding:.3rem .5rem; border-radius:.4rem; cursor:pointer;
      border:1px solid var(--ion-color-step-150, #e5e3df); background:none; color:inherit; font:inherit; }
    .match[aria-pressed='true'] { border-color: var(--ion-color-primary, #3880ff); font-weight:700; }
    .said { margin:0; color: var(--ion-color-step-600, #5b5852); font-style: italic; }
    .go { margin-top:.2rem; }
    .hold { margin:.1rem 0 .3rem; font-size:.8rem; font-weight:600;
      color: var(--ion-color-primary, #3880ff); }
    ion-button { --min-height: 44px; }
  `;
  }
  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("erplora:locale-changed", this.onLocaleChange);
    this.addEventListener("erp:whatsapp-request", this.onOpen);
  }
  disconnectedCallback() {
    window.removeEventListener("erplora:locale-changed", this.onLocaleChange);
    this.removeEventListener("erp:whatsapp-request", this.onOpen);
    this.stopHoldClock();
    super.disconnectedCallback();
  }
  /** The catalogues, through their PUBLIC queries — never another module's tables. */
  async loadCatalogs() {
    if (this.catalogsLoaded) return;
    this.catalogsLoaded = true;
    try {
      const [services, staffMembers, settings] = await Promise.all([
        erplora4().query("services.services.list", { limit: 500 }).catch(() => []),
        erplora4().query("staff.members.list", { limit: 500 }).catch(() => []),
        erplora4().query("appointments.settings.get").catch(() => [])
      ]);
      const cfg = rows4(settings)[0];
      if (cfg && cfg.hold_minutes !== void 0 && cfg.hold_minutes !== null) {
        this.holdMinutes = Number(cfg.hold_minutes) || 0;
      }
      this.services = rows4(services).filter(
        (s5) => s5.is_bookable === void 0 || Number(s5.is_bookable) === 1
      );
      this.staffMembers = rows4(staffMembers).filter(
        (s5) => (s5.status ?? "active") === "active" && (s5.is_bookable === void 0 || Number(s5.is_bookable) === 1)
      );
    } catch (e5) {
      this.error = e5 instanceof Error ? e5.message : erplora4().t(CATALOG4, "ui.errLoadCatalogs");
    }
  }
  async searchCustomers() {
    const term = this.search.trim();
    if (!term) {
      this.matches = [];
      return;
    }
    try {
      const result = await erplora4().query("customers.list", { search: term, limit: 8 });
      this.matches = rows4(result);
    } catch {
      this.matches = [];
    }
  }
  /** Creating the customer is an EXPLICIT act, prefilled — never a side effect of approving. */
  async createCustomer() {
    if (!this.open || !can("customers.add_customer")) return;
    this.busy = true;
    this.error = "";
    try {
      const name = this.open.contact_name || this.open.contact_phone;
      await erplora4().command("customers.create", { name, phone: this.open.contact_phone });
      this.search = this.open.contact_phone || name;
      await this.searchCustomers();
      const created = this.matches.find((c5) => c5.name === name);
      if (created) this.pickCustomer(created);
    } catch (e5) {
      this.error = e5 instanceof Error ? e5.message : erplora4().t(CATALOG4, "ui.errCreateCustomer");
    } finally {
      this.busy = false;
    }
  }
  pickCustomer(c5) {
    this.customerId = c5.id;
    this.customerLabel = c5.name;
  }
  /**
   * The stretches the business is open on `this.date`, asked of THE DOOR ITSELF — and, since
   * appointments#132, asked ONLY to caption the list, never to cut it.
   *
   * The authority over the business's hours is `schedules` (appointments#102) and the gate
   * (`appointments.appointments.create`) resolves the date through its precedence (ADR-0392).
   * Recutting the list here would be a second implementation of that precedence in TypeScript,
   * which is the disease and not the cure — the engine behind `appointments.availability.slots`
   * already runs the very function the gate runs (appointments#127).
   *
   * What survives is what the LIST CANNOT SAY BY ITSELF, because zero slots is not a reason:
   *   * `[]` — the authority resolved the date and the business is SHUT (`dayClosed`): the person
   *     at the counter has to read «closed today», not «no times left»;
   *   * `null` — either the authority carries no rule reaching the date (`source: "unset"`, and
   *     then the gate refuses nothing either), or it could not be asked at all, which is what
   *     `openingUnknown` warns about.
   *
   * Read-only, so it writes nothing.
   */
  async askDayOpening() {
    this.openingUnknown = false;
    if (!can("appointments.view_schedule")) return null;
    try {
      const answer = await erplora4().command("appointments.availability.day_opening", { date: this.date });
      const opening = answer?.result;
      if (!opening || opening.source !== "schedules") return null;
      return Array.isArray(opening.spans) ? opening.spans : [];
    } catch (e5) {
      if (e5?.code !== "permission_denied") this.openingUnknown = true;
      return null;
    }
  }
  /** Free slots RIGHT NOW, exactly as the hub's own availability engine hands them over — it has
   *  already narrowed them to what the door will accept (appointments#127/#132). The market's hard
   *  rule: what a person can pick has to be free at the moment they pick it, not when the message
   *  arrived — and it has to be bookable, not just free. */
  async loadSlots() {
    this.startDatetime = "";
    if (!this.date) {
      this.slots = [];
      this.dayClosed = false;
      this.openingUnknown = false;
      return;
    }
    const service = this.services.find((s5) => s5.id === this.serviceId);
    const opening = await this.askDayOpening();
    this.dayClosed = opening !== null && opening.length === 0;
    try {
      const answer = await erplora4().command("appointments.availability.slots", {
        date: this.date,
        staff_id: this.staffId,
        duration_minutes: service?.duration_minutes,
        // appointments#69: every hold hides its slot from this list — ours would hide the very
        // time we just took, which is the one moment a hold must NOT block anyone. Same role as
        // `exclude_appointment_id` when moving an appointment off its own slot.
        exclude_hold_ref: this.open?.request_id
      });
      const free = rows4(answer?.result);
      this.slots = free;
    } catch (e5) {
      this.slots = [];
      this.error = e5 instanceof Error ? e5.message : erplora4().t(CATALOG4, "ui.errLoadSlots");
    }
  }
  /** Picking a time SETS IT ASIDE (appointments#69).
   *
   *  The window that this closes is the one appointments#38 could only report after the fact:
   *  hours pass between the message and the approval, the counter sells the hour, and the booking
   *  is refused when somebody finally approves. Holding while the decision is being made is what
   *  the market does — Square holds 15 minutes while a customer completes a booking, Appointedd 7,
   *  Timify caps at 5, Phorest opens a 7-minute holding slot on the calendar while the salon rings
   *  back. Every documented number sits in the 5–15 band, because the clock only makes sense while
   *  a PERSON is waiting on screen.
   *
   *  The clock starts HERE and not when the message arrives, and that is forced, not chosen: what
   *  the model parsed is free text with no professional and no hour, so until somebody picks there
   *  is no slot to hold. The long variant of this mechanism (Odoo and Acuity park the request ON
   *  the calendar with no expiry at all) needs a request that already names a slot — and it is
   *  also the variant whose failure mode fills the forums: holds nobody reclaims, freed by hand.
   *
   *  Failing to hold does NOT block the booking. A hold is a courtesy that expires; refusing to
   *  continue because we could not take one would turn the best-effort half of the feature into a
   *  new way of not being able to book at all. */
  async pickSlot(s5) {
    this.startDatetime = s5.slot_start;
    this.holdExpired = false;
    if (!this.open || this.holdMinutes <= 0) return;
    try {
      await erplora4().command("appointments.slots.hold", {
        // Opaque both ways: we say who is asking and over which of THEIR rows. `appointments`
        // stores it without knowing what a WhatsApp request is, and a hub with no inbox never
        // learns this table exists.
        source: "whatsapp_inbox",
        source_ref: this.open.request_id,
        staff_id: this.staffId,
        start_datetime: s5.slot_start,
        end_datetime: s5.slot_end,
        label: this.customerLabel || this.open.contact_name || this.open.contact_phone
      });
      this.startHoldClock();
    } catch {
      this.holdUntil = 0;
      this.error = erplora4().t(CATALOG4, "ui.holdFailed");
    }
  }
  /** Gives the slot back. Only on an EXPLICIT walk-away: an unmount is not one (a host re-render
   *  would hand the slot back mid-decision), and the TTL already covers the operator who simply
   *  leaves — «if the user is gone, let it expire silently» is where the market lands. */
  async releaseHold() {
    this.stopHoldClock();
    if (!this.open || !this.holdUntil) return;
    this.holdUntil = 0;
    try {
      await erplora4().command("appointments.slots.release_hold", {
        source: "whatsapp_inbox",
        source_ref: this.open.request_id
      });
    } catch {
    }
  }
  startHoldClock() {
    this.holdUntil = Date.now() + this.holdMinutes * 6e4;
    this.stopHoldClock();
    this.tickHold();
    this.holdTicker = setInterval(() => this.tickHold(), 1e3);
  }
  stopHoldClock() {
    if (this.holdTicker) clearInterval(this.holdTicker);
    this.holdTicker = null;
  }
  tickHold() {
    const left = Math.max(0, this.holdUntil - Date.now());
    this.holdLeft = left;
    if (left > 0) return;
    this.stopHoldClock();
    this.holdUntil = 0;
    this.startDatetime = "";
    this.holdExpired = true;
    void this.loadSlots();
  }
  get ready() {
    return Boolean(this.customerId && this.serviceId && this.staffId && this.startDatetime);
  }
  /** Hands the BOUND request back to the host. Approving is the inbox's command, not ours: this
   *  module does not know how a request is approved, only what a booking needs. And it does NOT
   *  book here either — the appointment is created by the listener on the approval event, so the
   *  booking happens exactly once no matter which door the approval came through. */
  confirm() {
    if (!this.open || !this.ready) return;
    this.stopHoldClock();
    const service = this.services.find((s5) => s5.id === this.serviceId);
    this.dispatchEvent(new CustomEvent("erp:booking-resolved", {
      detail: {
        request_id: this.open.request_id,
        customer_id: this.customerId,
        service_id: this.serviceId,
        staff_id: this.staffId,
        start_datetime: this.startDatetime,
        duration_minutes: service?.duration_minutes,
        notes: this.open.raw_summary
      },
      bubbles: true,
      composed: true
    }));
  }
  async cancel() {
    await this.releaseHold();
    this.dispatchEvent(new CustomEvent("erp:booking-cancelled", { bubbles: true, composed: true }));
  }
  renderCustomer() {
    const t5 = (k2) => erplora4().t(CATALOG4, k2);
    if (this.customerId) {
      return b2`<div>
        <label>${t5("ui.bookingCustomer")}</label>
        <div class="actions">
          <strong>${this.customerLabel || this.customerId}</strong>
          <ion-button data-testid="appointments-request-booking-customer-change" size="small" fill="clear"
            @click=${() => {
        this.customerId = "";
        this.customerLabel = "";
        void this.searchCustomers();
      }}>
            ${t5("ui.bookingChange")}
          </ion-button>
        </div>
      </div>`;
    }
    return b2`<div>
      <label for="cust">${t5("ui.bookingCustomer")}</label>
      <input data-testid="appointments-request-booking-customer-search" id="cust" .value=${this.search} placeholder=${t5("ui.bookingCustomerSearch")}
        @input=${(e5) => {
      this.search = e5.target.value;
      void this.searchCustomers();
    }} />
      <div class="matches">
        ${this.matches.map((c5) => b2`<button type="button" class="match"
          data-testid=${`appointments-request-booking-customer-match-${c5.id}`}
          aria-pressed=${this.customerId === c5.id ? "true" : "false"}
          @click=${() => this.pickCustomer(c5)}>${c5.name}${c5.phone ? b2` · ${c5.phone}` : A}</button>`)}
      </div>
      ${can("customers.add_customer") ? b2`<ion-button data-testid="appointments-request-booking-create-customer" size="small" fill="outline" ?disabled=${this.busy}
        @click=${() => this.createCustomer()}>${t5("ui.bookingCreateCustomer")}</ion-button>` : A}
    </div>`;
  }
  render() {
    const t5 = (k2) => erplora4().t(CATALOG4, k2);
    if (!this.open) return A;
    return b2`<div class="panel">
      ${this.open.raw_summary ? b2`<p class="said">“${this.open.raw_summary}”</p>` : A}
      ${this.error ? b2`<ok-inline-feedback data-testid="appointments-request-booking-error" tone="danger">${this.error}</ok-inline-feedback>` : A}

      ${this.renderCustomer()}

      <div>
        <label for="svc">${t5("ui.bookingService")}</label>
        <select data-testid="appointments-request-booking-service" id="svc"
          @change=${(e5) => {
      this.serviceId = e5.target.value;
      void this.loadSlots();
    }}>
          <option value="">${t5("ui.bookingPick")}</option>
          ${this.services.map((s5) => b2`<option value=${s5.id} ?selected=${s5.id === this.serviceId}>${s5.name}</option>`)}
        </select>
      </div>

      <div>
        <label for="stf">${t5("ui.bookingStaff")}</label>
        <select data-testid="appointments-request-booking-staff" id="stf"
          @change=${(e5) => {
      this.staffId = e5.target.value;
      void this.loadSlots();
    }}>
          <option value="">${t5("ui.bookingPick")}</option>
          ${this.staffMembers.map((s5) => b2`<option value=${s5.id} ?selected=${s5.id === this.staffId}>${s5.full_name}</option>`)}
        </select>
      </div>

      <div>
        <label for="day">${t5("ui.bookingDay")}</label>
        <input data-testid="appointments-request-booking-day" id="day" type="date" .value=${this.date}
          @change=${(e5) => {
      this.date = e5.target.value;
      void this.loadSlots();
    }} />
      </div>

      <div>
        <label>${t5("ui.bookingSlot")}</label>
        ${this.holdUntil ? b2`<p class="hold">${t5("ui.holdCountdown").replace("{mins}", String(Math.floor(this.holdLeft / 6e4))).replace("{secs}", String(Math.floor(this.holdLeft % 6e4 / 1e3)).padStart(2, "0"))}</p>` : A}
        ${this.holdExpired ? b2`<ok-inline-feedback data-testid="appointments-request-booking-hold-expired" tone="warning" icon="time-outline">${t5("ui.holdExpired")}</ok-inline-feedback>` : A}
        ${this.openingUnknown ? b2`<ok-inline-feedback data-testid="appointments-request-booking-opening-unknown" tone="warning" icon="alert-circle-outline">${t5("ui.openingUnknown")}</ok-inline-feedback>` : A}
        ${this.slots.length === 0 ? b2`<p class="said">${t5(this.dayClosed ? "ui.bookingDayClosed" : "ui.bookingNoSlots")}</p>` : b2`<div class="slots">
              ${this.slots.map((s5) => b2`<button type="button" class="slot"
                data-testid=${`appointments-request-booking-slot-${s5.slot_start}`}
                aria-pressed=${this.startDatetime === s5.slot_start ? "true" : "false"}
                @click=${() => {
      void this.pickSlot(s5);
    }}>${s5.start_time}</button>`)}
            </div>`}
      </div>

      <div class="actions go">
        <ion-button data-testid="appointments-request-booking-confirm" ?disabled=${!this.ready || this.busy} @click=${() => this.confirm()}>
          ${t5("ui.bookingConfirm")}
        </ion-button>
        <span class="cancel"><ion-button data-testid="appointments-request-booking-cancel" fill="clear" color="medium"
          @click=${() => void this.cancel()}>${t5("ui.bookingCancel")}</ion-button></span>
      </div>
    </div>`;
  }
};
__decorateClass([
  r5()
], ErpAppointmentsRequestBooking.prototype, "open", 2);
__decorateClass([
  r5()
], ErpAppointmentsRequestBooking.prototype, "services", 2);
__decorateClass([
  r5()
], ErpAppointmentsRequestBooking.prototype, "staffMembers", 2);
__decorateClass([
  r5()
], ErpAppointmentsRequestBooking.prototype, "matches", 2);
__decorateClass([
  r5()
], ErpAppointmentsRequestBooking.prototype, "search", 2);
__decorateClass([
  r5()
], ErpAppointmentsRequestBooking.prototype, "customerId", 2);
__decorateClass([
  r5()
], ErpAppointmentsRequestBooking.prototype, "customerLabel", 2);
__decorateClass([
  r5()
], ErpAppointmentsRequestBooking.prototype, "serviceId", 2);
__decorateClass([
  r5()
], ErpAppointmentsRequestBooking.prototype, "staffId", 2);
__decorateClass([
  r5()
], ErpAppointmentsRequestBooking.prototype, "date", 2);
__decorateClass([
  r5()
], ErpAppointmentsRequestBooking.prototype, "slots", 2);
__decorateClass([
  r5()
], ErpAppointmentsRequestBooking.prototype, "dayClosed", 2);
__decorateClass([
  r5()
], ErpAppointmentsRequestBooking.prototype, "openingUnknown", 2);
__decorateClass([
  r5()
], ErpAppointmentsRequestBooking.prototype, "startDatetime", 2);
__decorateClass([
  r5()
], ErpAppointmentsRequestBooking.prototype, "busy", 2);
__decorateClass([
  r5()
], ErpAppointmentsRequestBooking.prototype, "error", 2);
__decorateClass([
  r5()
], ErpAppointmentsRequestBooking.prototype, "holdUntil", 2);
__decorateClass([
  r5()
], ErpAppointmentsRequestBooking.prototype, "holdLeft", 2);
__decorateClass([
  r5()
], ErpAppointmentsRequestBooking.prototype, "holdExpired", 2);
define("erp-appointments-request-booking", ErpAppointmentsRequestBooking);
