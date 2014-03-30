describe("Image and image input inline", function () {
    var firstImage = "firstImage.png",
        secondImage = "secondImage.png",
        firstImageDataURI = "mock_data_URI_of_the_first_image",
        secondImageDataURI = "mock_data_URI_of_the_second_image",
        joinUrlSpy, getDataURIForImageURLSpy, doc,
        urlMocks = {};

    var setupGetDataURIForImageURLMock = function () {
        return spyOn(inlineUtil, "getDataURIForImageURL").and.callFake(function (url) {
            var defer = ayepromise.defer();
            if (urlMocks[url] !== undefined) {
                defer.resolve(urlMocks[url]);
            } else {
                defer.reject({
                    url: 'THEURL' + url
                });
            }
            return defer.promise;
        });
    };

    var mockGetDataURIForImageURL = function (imageUrl, imageDataUri) {
        urlMocks[imageUrl] = imageDataUri;
    };

    beforeEach(function () {
        joinUrlSpy = spyOn(inlineUtil, "joinUrl");
        getDataURIForImageURLSpy = setupGetDataURIForImageURLMock();

        doc = document.implementation.createHTMLDocument("");
    });

    it("should load an external image", function (done) {
        mockGetDataURIForImageURL(firstImage, firstImageDataURI);
        doc.body.innerHTML = '<img id="image" src="' + firstImage + '" alt="test image"/>';

        inline.loadAndInlineImages(doc, {}).then(function () {
            expect(doc.getElementById("image").attributes.src.nodeValue).toEqual(firstImageDataURI);

            done();
        });
    });

    it("should load an input with type image", function (done) {
        mockGetDataURIForImageURL(firstImage, firstImageDataURI);
        doc.body.innerHTML = '<input type="image" id="input" src="' + firstImage + '" alt="test image"/>';

        inline.loadAndInlineImages(doc, {}).then(function () {
            expect(doc.getElementById("input").attributes.src.nodeValue).toEqual(firstImageDataURI);

            done();
        });
    });

    it("should load multiple external images", function (done) {
        mockGetDataURIForImageURL(firstImage, firstImageDataURI);
        mockGetDataURIForImageURL(secondImage, secondImageDataURI);
        doc.body.innerHTML = (
            '<img id="image1" src="' + firstImage + '" alt="test image"/>' +
            '<img id="image2" src="' + secondImage +'" alt="test image"/>'
        );

        inline.loadAndInlineImages(doc, {}).then(function () {
            expect(doc.getElementById("image1").attributes.src.nodeValue).toEqual(firstImageDataURI);
            expect(doc.getElementById("image2").attributes.src.nodeValue).toEqual(secondImageDataURI);

            done();
        });
    });

    it("should finish if no images found", function (done) {
        inline.loadAndInlineImages(doc, {}).then(done);
    });

    it("should not touch an already inlined image", function (done) {
        doc.body.innerHTML = '<img id="image" src="data:image/png;base64,soMEfAkebASE64=" alt="test image"/>';

        inline.loadAndInlineImages(doc, {}).then(function () {
            expect(doc.getElementById("image").src).toEqual('data:image/png;base64,soMEfAkebASE64=');

            done();
        });
    });

    it("should not touch an image without a src", function (done) {
        doc.body.innerHTML = '<img id="image">';

        inline.loadAndInlineImages(doc, {}).then(function () {
            expect(doc.getElementById("image").parentNode.innerHTML).toEqual('<img id="image">');

            done();
        });
    });

    it("should respect the document's baseURI when loading the image", function () {
        var getDocumentBaseUrlSpy = spyOn(inlineUtil, 'getDocumentBaseUrl').and.callThrough();

        doc = testHelper.readDocumentFixture("image.html");

        inline.loadAndInlineImages(doc, {});

        expect(getDataURIForImageURLSpy.calls.mostRecent().args[1].baseUrl).toEqual(doc.baseURI);
        expect(getDocumentBaseUrlSpy).toHaveBeenCalledWith(doc);
    });

    it("should respect optional baseUrl when loading the image", function () {
        doc = testHelper.readDocumentFixtureWithoutBaseURI("image.html");

        inline.loadAndInlineImages(doc, {baseUrl: "aBaseUrl"});

        expect(getDataURIForImageURLSpy.calls.mostRecent().args[1].baseUrl).toEqual("aBaseUrl");
    });

    it("should favour explicit baseUrl over document.baseURI when loading the image", function () {
        var baseUrl = "aBaseUrl";

        doc = testHelper.readDocumentFixture("image.html");
        expect(doc.baseURI).not.toBeNull();
        expect(doc.baseURI).not.toEqual("about:blank");
        expect(doc.baseURI).not.toEqual(baseUrl);

        inline.loadAndInlineImages(doc, {baseUrl: baseUrl});

        expect(getDataURIForImageURLSpy.calls.mostRecent().args[1].baseUrl).toEqual(baseUrl);
    });

    it("should circumvent caching if requested", function () {
        doc.body.innerHTML = '<img id="image" src="' + firstImage + '" alt="test image"/>';

        inline.loadAndInlineImages(doc, {cache: 'none'});

        expect(getDataURIForImageURLSpy).toHaveBeenCalledWith(jasmine.any(String), {cache: 'none'});
    });

    it("should not circumvent caching by default", function () {
        doc.body.innerHTML = '<img id="image" src="' + firstImage + '" alt="test image"/>';

        inline.loadAndInlineImages(doc, {});

        expect(getDataURIForImageURLSpy).toHaveBeenCalledWith(jasmine.any(String), {});
    });

    describe("on errors", function () {
        var imageThatDoesExist = "image_that_does_exist.png";

        beforeEach(function () {
            joinUrlSpy.and.callThrough();

            mockGetDataURIForImageURL(imageThatDoesExist, "theDataUri");
        });

        it("should report an error if an image could not be loaded", function (done) {
            doc.body.innerHTML = '<img src="image_that_doesnt_exist.png" alt="test image"/>';

            inline.loadAndInlineImages(doc, {}).then(function (errors) {
                errors = testHelper.deleteAdditionalFieldsFromErrorsUnderPhantomJS(errors);

                expect(errors).toEqual([{
                    resourceType: "image",
                    url: 'THEURL' + "image_that_doesnt_exist.png",
                    msg: "Unable to load image " + "THEURL" + "image_that_doesnt_exist.png"
                }]);

                done();
            });
        });

        it("should only report a failing image as error", function (done) {
            doc.body.innerHTML = (
                '<img src="image_that_doesnt_exist.png" alt="test image"/>' +
                '<img src="' + imageThatDoesExist + '" alt="test image"/>'
            );

            inline.loadAndInlineImages(doc, {}).then(function (errors) {
                errors = testHelper.deleteAdditionalFieldsFromErrorsUnderPhantomJS(errors);

                expect(errors).toEqual([{
                    resourceType: "image",
                    url: 'THEURL' + "image_that_doesnt_exist.png",
                    msg: jasmine.any(String)
                }]);

                done();
            });
        });

        it("should report multiple failing images as error", function (done) {
            doc.body.innerHTML = (
                '<img src="image_that_doesnt_exist.png" alt="test image"/>' +
                '<img src="another_image_that_doesnt_exist.png" alt="test image"/>'
            );

            inline.loadAndInlineImages(doc, {}).then(function (errors) {
                expect(errors).toEqual([jasmine.any(Object), jasmine.any(Object)]);
                expect(errors[0]).not.toEqual(errors[1]);

                done();
            });
        });

        it("should report an empty list for a successful image", function (done) {
            doc.body.innerHTML = ('<img src="' + imageThatDoesExist + '" alt="test image"/>');

            inline.loadAndInlineImages(doc, {}).then(function (errors) {
                expect(errors).toEqual([]);

                done();
            });
        });
    });
});
