export function netflix() {
  const defineProperty = Object.defineProperty;
  Object.defineProperty = new Proxy(defineProperty, {
    apply(target, thisArg, argumentsList) {
      const [object, property, original] = argumentsList;
      let descriptor = original;
      if (original && typeof original === 'object' && Object.hasOwn(original, 'value')) {
        if (property === 'adBreaks') descriptor = { ...original, value: [] };
        else if (property === 'adState') descriptor = { ...original, value: null };
        else if (property === 'currentAdBreak') descriptor = { ...original, value: undefined };
        else if (property === 'getAdBreaks' || property === 'getAdsDisplayStringParams') descriptor = { ...original, value: function () {} };
      }
      return Reflect.apply(target, thisArg, [object, property, descriptor]);
    }
  });
}
