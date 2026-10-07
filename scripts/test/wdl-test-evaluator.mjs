// A deliberately small evaluator for the WDL expressions emitted by the watchdog.
// It checks actual generated expressions, not a separately reimplemented timer predicate.
export function evaluate(expression, context) {
  if (typeof expression !== 'string' || !expression.startsWith('@')) return expression;
  let index = 1;
  const skip = () => { while (/\s/.test(expression[index] ?? '') && index < expression.length) index++; };
  const expect = (value) => {
    skip();
    if (!expression.startsWith(value, index)) throw new Error(`Expected ${value} at ${index}: ${expression}`);
    index += value.length;
  };
  const functions = {
    parameters: (key) => context.parameters[key],
    variables: (key) => context.variables?.[key],
    body: (name) => context.bodies?.[name] ?? null,
    outputs: (name) => context.outputs?.[name] ?? null,
    actions: (name) => context.actions?.[name] ?? { status: 'Skipped' },
    item: () => context.item,
    first: (value) => value[0] ?? null,
    if: (condition, yes, no) => condition ? yes : no,
    guid: () => '12345678-1234-1234-1234-123456789abc',
    utcNow: () => context.now,
    addMinutes: (value, minutes) => new Date(Date.parse(value) + minutes * 60_000).toISOString(),
    ticks: (value) => {
      const ticks = Date.parse(value);
      if (!Number.isFinite(ticks)) throw new Error('Invalid WDL ticks input');
      return ticks;
    },
    and: (...values) => values.every(Boolean),
    or: (...values) => values.some(Boolean),
    not: (value) => !value,
    equals: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    lessOrEquals: (left, right) => left <= right,
    coalesce: (...values) => values.find((value) => value !== null && value !== undefined) ?? null,
    concat: (...values) => values.join(''),
    createArray: (...values) => values,
    contains: (value, item) => value.includes(item),
    startsWith: (value, prefix) => value.startsWith(prefix),
    endsWith: (value, suffix) => value.endsWith(suffix),
    split: (value, separator) => value.split(separator),
    uriQuery: (value) => new URL(value).search,
    length: (value) => value.length,
    toLower: (value) => value.toLowerCase(),
    empty: (value) => value == null || value.length === 0,
    replace: (value, from, to) => value.replaceAll(from, to),
    json: JSON.parse,
    setProperty: (value, key, property) => ({ ...value, [key]: property }),
  };
  function value() {
    skip();
    let result;
    if (expression[index] === "'") {
      index++;
      result = '';
      while (index < expression.length) {
        if (expression[index] === "'") {
          index++;
          if (expression[index] !== "'") break;
        }
        result += expression[index++];
      }
    } else {
      const token = expression.slice(index).match(/^(?:[A-Za-z_][A-Za-z_0-9]*|-?\d+)/)?.[0];
      if (!token) throw new Error(`Missing WDL value at ${index}: ${expression}`);
      index += token.length;
      skip();
      if (expression[index] === '(') {
        index++;
        const args = [];
        skip();
        while (expression[index] !== ')') {
          args.push(value());
          skip();
          if (expression[index] !== ',') break;
          index++;
        }
        expect(')');
        if (!functions[token]) throw new Error(`Unsupported WDL function ${token}`);
        result = functions[token](...args);
      } else if (token === 'null') result = null;
      else if (token === 'true' || token === 'false') result = token === 'true';
      else if (/^-?\d+$/.test(token)) result = Number(token);
      else throw new Error(`Unexpected WDL token ${token}`);
    }
    while (expression.startsWith('?[', index)) {
      index += 2;
      const key = value();
      expect(']');
      result = result?.[key] ?? null;
    }
    return result;
  }
  const result = value();
  skip();
  if (index !== expression.length) throw new Error(`Unparsed WDL tail: ${expression.slice(index)}`);
  return result;
}

export function actionMap(definition) {
  const result = {};
  function visit(actions) {
    for (const [name, action] of Object.entries(actions ?? {})) {
      if (result[name]) throw new Error(`Duplicate WDL action ${name}`);
      result[name] = action;
      for (const predecessor of Object.keys(action.runAfter ?? {})) {
        if (!(predecessor in actions)) throw new Error(`WDL predecessor ${predecessor} is outside its action scope.`);
      }
      visit(action.actions);
      visit(action.else?.actions);
    }
  }
  visit(definition.actions);
  return result;
}
