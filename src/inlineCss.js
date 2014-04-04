"use strict";

var cssom = require('cssom'),
    ayepromise = require('ayepromise'),
    inlineUtil = require('./inlineUtil'),
    cssSupport = require('./cssSupport'),
    backgroundValueParser = require('./backgroundValueParser');


var updateCssPropertyValue = function (rule, property, value) {
    rule.style.setProperty(property, value, rule.style.getPropertyPriority(property));
};

var rulesForCssTextFromBrowser = function (styleContent) {
    var doc = document.implementation.createHTMLDocument(""),
        styleElement = document.createElement("style"),
        rules;

    styleElement.textContent = styleContent;
    // the style will only be parsed once it is added to a document
    doc.body.appendChild(styleElement);
    rules = styleElement.sheet.cssRules;

    return Array.prototype.slice.call(rules);
};

var browserHasBackgroundImageUrlIssue = (function () {
    // Checks for http://code.google.com/p/chromium/issues/detail?id=161644
    var rules = rulesForCssTextFromBrowser('a{background:url(i)}');
    return !rules.length || rules[0].cssText.indexOf('url()') >= 0;
}());

exports.rulesForCssText = function (styleContent) {
    if (browserHasBackgroundImageUrlIssue && cssom.parse) {
        return cssom.parse(styleContent).cssRules;
    } else {
        return rulesForCssTextFromBrowser(styleContent);
    }
};

var findBackgroundImageRules = function (cssRules) {
    return cssRules.filter(function (rule) {
        return rule.type === window.CSSRule.STYLE_RULE && (rule.style.getPropertyValue('background-image') || rule.style.getPropertyValue('background'));
    });
};

var findBackgroundDeclarations = function (rules) {
    var backgroundDeclarations = [];

    rules.forEach(function (rule) {
        if (rule.style.getPropertyValue('background-image')) {
            backgroundDeclarations.push({
                property: 'background-image',
                value: rule.style.getPropertyValue('background-image'),
                rule: rule
            });
        } else if (rule.style.getPropertyValue('background')) {
            backgroundDeclarations.push({
                property: 'background',
                value: rule.style.getPropertyValue('background'),
                rule: rule
            });
        }
    });

    return backgroundDeclarations;
};

var findFontFaceRules = function (cssRules) {
    return cssRules.filter(function (rule) {
        return rule.type === window.CSSRule.FONT_FACE_RULE && rule.style.getPropertyValue("src");
    });
};

exports.cssRulesToText = function (cssRules) {
    return cssRules.reduce(function (cssText, rule) {
        return cssText + rule.cssText;
    }, '');
};

var unquoteString = function (quotedUrl) {
    var doubleQuoteRegex = /^"(.*)"$/,
        singleQuoteRegex = /^'(.*)'$/;

    if (doubleQuoteRegex.test(quotedUrl)) {
        return quotedUrl.replace(doubleQuoteRegex, "$1");
    } else {
        if (singleQuoteRegex.test(quotedUrl)) {
            return quotedUrl.replace(singleQuoteRegex, "$1");
        } else {
            return quotedUrl;
        }
    }
};

var findFontFaceFormat = function (value) {
    var fontFaceFormatRegex = /^format\(([^\)]+)\)/,
        quotedFormat;

    if (!fontFaceFormatRegex.test(value)) {
        return null;
    }

    quotedFormat = fontFaceFormatRegex.exec(value)[1];
    return unquoteString(quotedFormat);
};

var extractFontFaceSrcUrl = function (reference) {
    var url, format = null;

    try {
        url = cssSupport.extractCssUrl(reference[0]);
        if (reference[1]) {
            format = findFontFaceFormat(reference[1]);
        }
        return {
            url: url,
            format: format
        };
    } catch (e) {}
};

var exchangeRule = function (cssRules, rule, newRuleText) {
    var ruleIdx = cssRules.indexOf(rule),
        styleSheet = rule.parentStyleSheet;

    // Generate a new rule
    styleSheet.insertRule(newRuleText, ruleIdx+1);
    styleSheet.deleteRule(ruleIdx);
    // Exchange with the new
    cssRules[ruleIdx] = styleSheet.cssRules[ruleIdx];
};

var findCSSImportRules = function (cssRules) {
    return cssRules.filter(function (rule) {
        return rule.type === window.CSSRule.IMPORT_RULE && rule.href;
    });
};

// Workaround for https://bugzilla.mozilla.org/show_bug.cgi?id=443978
var changeFontFaceRuleSrc = function (cssRules, rule, newSrc) {
    var newRuleText = '@font-face { font-family: ' + rule.style.getPropertyValue("font-family") + '; ';

    if (rule.style.getPropertyValue("font-style")) {
        newRuleText += 'font-style: ' + rule.style.getPropertyValue("font-style") + '; ';
    }

    if (rule.style.getPropertyValue("font-weight")) {
        newRuleText += 'font-weight: ' + rule.style.getPropertyValue("font-weight") + '; ';
    }

    newRuleText += 'src: ' + newSrc + '}';
    exchangeRule(cssRules, rule, newRuleText);
};

var findExternalBackgroundUrls = function (parsedBackground) {
    var matchIndices = [];

    parsedBackground.forEach(function (backgroundLayer, i) {
        if (backgroundLayer.url && !inlineUtil.isDataUri(backgroundLayer.url)) {
            matchIndices.push(i);
        }
    });

    return matchIndices;
};

var findExternalFontFaceUrls = function (parsedFontFaceSources) {
    var sourceIndices = [];
    parsedFontFaceSources.forEach(function (sourceItem, i) {
        if (sourceItem.url && !inlineUtil.isDataUri(sourceItem.url)) {
            sourceIndices.push(i);
        }
    });
    return sourceIndices;
};

var sliceFontFaceSrcReferences = function (fontFaceSrc) {
    var functionParamRegexS = "\\s*(?:\"[^\"]*\"|'[^']*'|[^\\(]+)\\s*",
        referenceRegexS = "(local\\(" + functionParamRegexS + "\\))" + "|" +
                          "(url\\(" + functionParamRegexS + "\\))" + "(?:\\s+(format\\(" + functionParamRegexS + "\\)))?",
        simpleFontFaceSrcRegexS = "^\\s*(" + referenceRegexS + ")" +
                                  "(?:\\s*,\\s*(" + referenceRegexS + "))*" +
                                  "\\s*$",
        referenceRegex = new RegExp(referenceRegexS, "g"),
        repeatedMatch,
        fontFaceSrcReferences = [],
        getReferences = function (match) {
            var references = [];
            match.slice(1).forEach(function (elem) {
                if (elem) {
                    references.push(elem);
                }
            });
            return references;
        };

    if (fontFaceSrc.match(new RegExp(simpleFontFaceSrcRegexS))) {
        repeatedMatch = referenceRegex.exec(fontFaceSrc);
        while (repeatedMatch) {
            fontFaceSrcReferences.push(getReferences(repeatedMatch));
            repeatedMatch = referenceRegex.exec(fontFaceSrc);
        }
        return fontFaceSrcReferences;
    }
    // we should probably throw an exception here
    return [];
};

var parseFontFaceSrcDeclaration = function (fontFaceSourceValue) {
    var fontReferences = sliceFontFaceSrcReferences(fontFaceSourceValue);

    return fontReferences.map(function (reference) {
        var fontSrc = extractFontFaceSrcUrl(reference);

        if (fontSrc) {
            return fontSrc;
        } else {
            return {
                local: reference
            };
        }
    });
};

var parsedFontFaceSrcDeclarationToText = function (parsedFontFaceSources) {
    return parsedFontFaceSources.map(function (sourceItem) {
        var itemValue;

        if (sourceItem.url) {
            itemValue = 'url("' + sourceItem.url + '")';
            if (sourceItem.format) {
                itemValue += ' format("' + sourceItem.format + '")';
            }
        } else {
            itemValue = sourceItem.local;
        }
        return itemValue;
    }).join(', ');
};

exports.adjustPathsOfCssResources = function (baseUrl, cssRules) {
    var backgroundRules = findBackgroundImageRules(cssRules),
        backgroundDeclarations = findBackgroundDeclarations(backgroundRules),
        change = false;

    backgroundDeclarations.forEach(function (declaration) {
        var parsedBackground = backgroundValueParser.parse(declaration.value),
            externalBackgroundIndices = findExternalBackgroundUrls(parsedBackground),
            backgroundValue;

        if (externalBackgroundIndices.length > 0) {
            externalBackgroundIndices.forEach(function (backgroundLayerIndex) {
                var relativeUrl = parsedBackground[backgroundLayerIndex].url,
                    url = inlineUtil.joinUrl(baseUrl, relativeUrl);
                parsedBackground[backgroundLayerIndex].url = url;
            });

            backgroundValue = backgroundValueParser.serialize(parsedBackground);

            updateCssPropertyValue(declaration.rule, declaration.property, backgroundValue);

            change = true;
        }
    });
    findFontFaceRules(cssRules).forEach(function (rule) {
        var fontFaceSrcDeclaration = rule.style.getPropertyValue("src"),
            parsedFontFaceSources = parseFontFaceSrcDeclaration(fontFaceSrcDeclaration),
            externalFontFaceUrlIndices = findExternalFontFaceUrls(parsedFontFaceSources);

        if (externalFontFaceUrlIndices.length > 0) {
            externalFontFaceUrlIndices.forEach(function (fontFaceUrlIndex) {
                var relativeUrl = parsedFontFaceSources[fontFaceUrlIndex].url,
                    url = inlineUtil.joinUrl(baseUrl, relativeUrl);

                parsedFontFaceSources[fontFaceUrlIndex].url = url;
            });

            changeFontFaceRuleSrc(cssRules, rule, parsedFontFaceSrcDeclarationToText(parsedFontFaceSources));

            change = true;
        }
    });
    findCSSImportRules(cssRules).forEach(function (rule) {
        var cssUrl = rule.href,
            url = inlineUtil.joinUrl(baseUrl, cssUrl);

        exchangeRule(cssRules, rule, "@import url(" + url + ");");

        change = true;
    });

    return change;
};

/* CSS import inlining */

var substituteRule = function (cssRules, rule, newCssRules) {
    var position = cssRules.indexOf(rule);

    cssRules.splice(position, 1);

    newCssRules.forEach(function (newRule, i) {
        cssRules.splice(position + i, 0, newRule);
    });
};

var isQuotedString = function (string) {
    var doubleQuoteRegex = /^"(.*)"$/,
        singleQuoteRegex = /^'(.*)'$/;

    return doubleQuoteRegex.test(string) || singleQuoteRegex.test(string);
};

var fulfilledPromise = function (value) {
    var defer = ayepromise.defer();
    defer.resolve(value);
    return defer.promise;
};

var loadAndInlineCSSImport = function (cssRules, rule, alreadyLoadedCssUrls, options) {
    var url = rule.href,
        cssHrefRelativeToDoc;

    if (isQuotedString(url)) {
        url = unquoteString(url);
    }

    cssHrefRelativeToDoc = inlineUtil.joinUrl(options.baseUrl, url);

    if (alreadyLoadedCssUrls.indexOf(cssHrefRelativeToDoc) >= 0) {
        // Remove URL by adding empty string
        substituteRule(cssRules, rule, []);
        return fulfilledPromise([]);
    } else {
        alreadyLoadedCssUrls.push(cssHrefRelativeToDoc);
    }

    return inlineUtil.ajax(url, options)
        .then(function (cssText) {
            var externalCssRules = exports.rulesForCssText(cssText);

            // Recursively follow @import statements
            return exports.loadCSSImportsForRules(externalCssRules, alreadyLoadedCssUrls, options)
                .then(function (result) {
                    exports.adjustPathsOfCssResources(url, externalCssRules);

                    substituteRule(cssRules, rule, externalCssRules);

                    return result.errors;
                });
        }, function (e) {
            throw {
                resourceType: "stylesheet",
                url: e.url,
                msg: "Unable to load stylesheet " + e.url
            };
        });
};

exports.loadCSSImportsForRules = function (cssRules, alreadyLoadedCssUrls, options) {
    var rulesToInline = findCSSImportRules(cssRules),
        errors = [],
        hasChanges = false;

    return inlineUtil.all(rulesToInline.map(function (rule) {
        return loadAndInlineCSSImport(cssRules, rule, alreadyLoadedCssUrls, options).then(function (moreErrors) {
            errors = errors.concat(moreErrors);

            hasChanges = true;
        }, function (e) {
            errors.push(e);
        });
    })).then(function () {
        return {
            hasChanges: hasChanges,
            errors: errors
        };
    });
};

/* CSS linked resource inlining */

var loadAndInlineBackgroundImages = function (backgroundValue, options) {
    var parsedBackground = backgroundValueParser.parse(backgroundValue),
        externalBackgroundLayerIndices = findExternalBackgroundUrls(parsedBackground),
        hasChanges = false;

    return inlineUtil.collectAndReportErrors(externalBackgroundLayerIndices.map(function (backgroundLayerIndex) {
        var url = parsedBackground[backgroundLayerIndex].url;

        return inlineUtil.getDataURIForImageURL(url, options)
            .then(function (dataURI) {
                parsedBackground[backgroundLayerIndex].url = dataURI;

                hasChanges = true;
            }, function (e) {
                throw {
                    resourceType: "backgroundImage",
                    url: e.url,
                    msg: "Unable to load background-image " + e.url
                };
            });
    })).then(function (errors) {
        return {
            backgroundValue: backgroundValueParser.serialize(parsedBackground),
            hasChanges: hasChanges,
            errors: errors
        };
    });
};

var iterateOverRulesAndInlineBackgroundImages = function (cssRules, options) {
    var rulesToInline = findBackgroundImageRules(cssRules),
        backgroundDeclarations = findBackgroundDeclarations(rulesToInline),
        errors = [],
        cssHasChanges = false;

    return inlineUtil.all(backgroundDeclarations.map(function (declaration) {
        return loadAndInlineBackgroundImages(declaration.value, options)
            .then(function (result) {
                if (result.hasChanges) {
                    updateCssPropertyValue(declaration.rule, declaration.property, result.backgroundValue);

                    cssHasChanges = true;
                }

                errors = errors.concat(result.errors);
            });
    })).then(function () {
        return {
            hasChanges: cssHasChanges,
            errors: errors
        };
    });
};

var loadAndInlineFontFace = function (srcDeclarationValue, options) {
    var parsedFontFaceSources = parseFontFaceSrcDeclaration(srcDeclarationValue),
        externalFontFaceUrlIndices = findExternalFontFaceUrls(parsedFontFaceSources),
        hasChanges = false;

    return inlineUtil.collectAndReportErrors(externalFontFaceUrlIndices.map(function (urlIndex) {
        var fontSrc = parsedFontFaceSources[urlIndex],
            format = fontSrc.format || "woff";

        return inlineUtil.binaryAjax(fontSrc.url, options)
            .then(function (content) {
                var base64Content = btoa(content);
                fontSrc.url = 'data:font/' + format + ';base64,' + base64Content;

                hasChanges = true;
            }, function (e) {
                throw {
                    resourceType: "fontFace",
                    url: e.url,
                    msg: "Unable to load font-face " + e.url
                };
            });
    })).then(function (errors) {
        return {
            srcDeclarationValue: parsedFontFaceSrcDeclarationToText(parsedFontFaceSources),
            hasChanges: hasChanges,
            errors: errors
        };
    });
};

var iterateOverRulesAndInlineFontFace = function (cssRules, options) {
    var rulesToInline = findFontFaceRules(cssRules),
        errors = [],
        hasChanges = false;

    return inlineUtil.all(rulesToInline.map(function (rule) {
        var srcDeclarationValue = rule.style.getPropertyValue("src");

        return loadAndInlineFontFace(srcDeclarationValue, options).then(function (result) {
            if (result.hasChanges) {
                changeFontFaceRuleSrc(cssRules, rule, result.srcDeclarationValue);

                hasChanges = true;
            }

            errors = errors.concat(result.errors);
        });
    })).then(function () {
        return {
            hasChanges: hasChanges,
            errors: errors
        };
    });
};

exports.loadAndInlineCSSResourcesForRules = function (cssRules, options) {
    var hasChanges = false,
        errors = [];

    return inlineUtil.all([iterateOverRulesAndInlineBackgroundImages, iterateOverRulesAndInlineFontFace].map(function (func) {
        return func(cssRules, options)
            .then(function (result) {
                hasChanges = hasChanges || result.hasChanges;
                errors = errors.concat(result.errors);
            });
    })).then(function () {
        return {
            hasChanges: hasChanges,
            errors: errors
        };
    });
};
