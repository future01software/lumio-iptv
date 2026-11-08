// wildcard-match v5.1.4 (ISC) — vendored from npm; zero dependencies.
// https://github.com/axtgr/wildcard-match
'use strict';

/**
 * Escapes a character if it has a special meaning in regular expressions
 * and returns the character as is if it doesn't
 */
function escapeRegExpChar(char) {
    if (char === '-' ||
        char === '^' ||
        char === '$' ||
        char === '+' ||
        char === '.' ||
        char === '(' ||
        char === ')' ||
        char === '|' ||
        char === '[' ||
        char === ']' ||
        char === '{' ||
        char === '}' ||
        char === '*' ||
        char === '?' ||
        char === '\\') {
        return "\\".concat(char);
    }
    else {
        return char;
    }
}
/**
 * Escapes all characters in a given string that have a special meaning in regular expressions
 */
function escapeRegExpString(str) {
    let result = '';
    for (let i = 0; i < str.length; i++) {
        result += escapeRegExpChar(str[i]);
    }
    return result;
}
/**
 * Transforms one or more glob patterns into a RegExp pattern
 */
function transform(pattern, separator) {
    if (separator === void 0) { separator = true; }
    if (Array.isArray(pattern)) {
        let regExpPatterns = pattern.map(function (p) { return "^".concat(transform(p, separator), "$"); });
        return "(?:".concat(regExpPatterns.join('|'), ")");
    }
    let separatorSplitter = '';
    let separatorMatcher = '';
    let wildcard = '.';
    if (separator === true) {
        separatorSplitter = '/';
        separatorMatcher = '[/\\\\]';
        wildcard = '[^/\\\\]';
    }
    else if (separator) {
        separatorSplitter = separator;
        separatorMatcher = escapeRegExpString(separatorSplitter);
        if (separatorMatcher.length > 1) {
            separatorMatcher = "(?:".concat(separatorMatcher, ")");
            wildcard = "((?!".concat(separatorMatcher, ").)");
        }
        else {
            wildcard = "[^".concat(separatorMatcher, "]");
        }
    }
    let requiredSeparator = separator ? "".concat(separatorMatcher, "+?") : '';
    let optionalSeparator = separator ? "".concat(separatorMatcher, "*?") : '';
    let segments = separator ? pattern.split(separatorSplitter) : [pattern];
    let result = '';
    for (let s = 0; s < segments.length; s++) {
        let segment = segments[s];
        let nextSegment = segments[s + 1];
        let currentSeparator = '';
        if (!segment && s > 0) {
            continue;
        }
        if (separator) {
            if (s === segments.length - 1) {
                currentSeparator = optionalSeparator;
            }
            else if (nextSegment !== '**') {
                currentSeparator = requiredSeparator;
            }
            else {
                currentSeparator = '';
            }
        }
        if (separator && segment === '**') {
            if (currentSeparator) {
                result +=
                    s === 0
                        ? ''
                        : s === segments.length - 1
                            ? "(?:".concat(requiredSeparator, "|$)")
                            : requiredSeparator;
                result += "(?:".concat(wildcard, "*?").concat(currentSeparator, ")*?");
            }
            continue;
        }
        for (let c = 0; c < segment.length; c++) {
            let char = segment[c];
            if (char === '\\') {
                if (c < segment.length - 1) {
                    result += escapeRegExpChar(segment[c + 1]);
                    c++;
                }
            }
            else if (char === '?') {
                result += wildcard;
            }
            else if (char === '*') {
                result += "".concat(wildcard, "*?");
            }
            else {
                result += escapeRegExpChar(char);
            }
        }
        result += currentSeparator;
    }
    return result;
}

function isMatch(regexp, sample) {
    if (typeof sample !== 'string') {
        throw new TypeError("Sample must be a string, but ".concat(typeof sample, " given"));
    }
    return regexp.test(sample);
}
/**
 * Compiles one or more glob patterns into a RegExp and returns an isMatch function.
 * The isMatch function takes a sample string as its only argument and returns `true`
 * if the string matches the pattern(s).
 *
 * ```js
 * wildcardMatch('src/*.js')('src/index.js') //=> true
 * ```
 *
 * ```js
 * const isMatch = wildcardMatch('*.example.com', '.')
 * isMatch('foo.example.com') //=> true
 * isMatch('foo.bar.com') //=> false
 * ```
 */
function wildcardMatch(pattern, options) {
    if (typeof pattern !== 'string' && !Array.isArray(pattern)) {
        throw new TypeError("The first argument must be a single pattern string or an array of patterns, but ".concat(typeof pattern, " given"));
    }
    if (typeof options === 'string' || typeof options === 'boolean') {
        options = { separator: options };
    }
    if (arguments.length === 2 &&
        !(typeof options === 'undefined' ||
            (typeof options === 'object' && options !== null && !Array.isArray(options)))) {
        throw new TypeError("The second argument must be an options object or a string/boolean separator, but ".concat(typeof options, " given"));
    }
    options = options || {};
    if (options.separator === '\\') {
        throw new Error('\\ is not a valid separator because it is used for escaping. Try setting the separator to `true` instead');
    }
    let regexpPattern = transform(pattern, options.separator);
    let regexp = new RegExp("^".concat(regexpPattern, "$"), options.flags);
    let fn = isMatch.bind(null, regexp);
    fn.options = options;
    fn.pattern = pattern;
    fn.regexp = regexp;
    return fn;
}

module.exports = wildcardMatch;
//# sourceMappingURL=index.js.map
