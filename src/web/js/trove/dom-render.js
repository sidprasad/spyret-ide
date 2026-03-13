({
    requires: [],
    nativeRequires: [],
    provides: {
        values: {
            genlayout: ["arrow", [["RawArray", "Any"], "String"], "Any"],
        }
    },
    theModule: function (runtime, namespace, uri) {


        function getSpytialCore() {
            const core = window.spytialcore || window.CndCore || window.CnDCore;
            if (!core) {
                throw new Error("spytial-core runtime is unavailable. Ensure browser bundles are loaded.");
            }
            return core;
        }

        function parseLayoutSpecSafe(core, cndSpec) {
            const normalizedSpec = typeof cndSpec === "string" ? cndSpec.trim() : "";
            if (!normalizedSpec) {
                return core.parseLayoutSpec("constraints: []\ndirectives: []");
            }
            return core.parseLayoutSpec(normalizedSpec);
        }

        function renderPyretLayoutPreview(core, graphElement, dataInstance, cndSpec) {
            const evaluationContext = { sourceData: dataInstance };
            const evaluator = new core.Evaluators.SGraphQueryEvaluator();
            evaluator.initialize(evaluationContext);
            const layoutSpec = parseLayoutSpecSafe(core, cndSpec);
            const layoutInstance = new core.LayoutInstance(layoutSpec, evaluator, 0, true);
            const layoutResult = layoutInstance.generateLayout(dataInstance, {});
            return graphElement.renderLayout(layoutResult.layout);
        }

        ///// Layout Generation /////
        function genlayout(v, cndSpec) {

            const container = document.createElement("div");
            container.style.border = "1px solid #ccc";
            container.style.padding = "5px";
            container.style.margin = "10px 0";
            container.style.position = "relative"; // For positioning elements inside the container

            // Create error message mount point
            const errorDiv = document.createElement("div");
            errorDiv.id = "error-message-container-" + Math.random().toString(36).slice(2);
            container.appendChild(errorDiv);

            try {
                const core = getSpytialCore();

                // Spytial core layout logic
                const dataInstance = new core.PyretDataInstance(v, {}, window.__internalRepl);
                const evaluationContext = { sourceData: dataInstance };
                const evaluator = new core.Evaluators.SGraphQueryEvaluator();
                evaluator.initialize(evaluationContext);
                const r = dataInstance.reify();
                const layoutSpec = parseLayoutSpecSafe(core, cndSpec);
                const ENABLE_ALIGNMENT_EDGES = true;
                const instanceNumber = 0;
                const layoutInstance = new core.LayoutInstance(
                    layoutSpec,
                    evaluator,
                    instanceNumber,
                    ENABLE_ALIGNMENT_EDGES
                );
                const projections = {};
                const layoutResult = layoutInstance.generateLayout(dataInstance, projections);
                const currentInstanceLayout = layoutResult.layout;

                // String view
                const stringView = document.createElement("pre");
                stringView.textContent = String(r);
                stringView.style.margin = "0 0 10px 0"; // Add spacing between the string view and the graph
                container.appendChild(stringView);

                // Graph container (to hold the graph and the toggle button)
                const graphContainer = document.createElement("div");
                graphContainer.style.position = "relative"; // For positioning the toggle button
                graphContainer.style.marginTop = "10px";

                // Graph element (initially visible)
                const graphElement = document.createElement("webcola-cnd-graph");
                graphElement.setAttribute("width", "400");
                graphElement.setAttribute("height", "400");
                graphElement.style.display = "block"; // Start visible
                graphElement.style.margin = "0 auto"; // Center the graph within the container

                // Add the graph element to the graph container
                graphContainer.appendChild(graphElement);

                // Collapse/Expand button (small + / - in the top-right corner of the graph container)
                const toggleButton = document.createElement("button");
                toggleButton.textContent = "-"; // Default state is expanded
                toggleButton.style.position = "absolute";
                toggleButton.style.top = "5px";
                toggleButton.style.right = "5px";
                toggleButton.style.padding = "2px 5px";
                toggleButton.style.fontSize = "12px";
                toggleButton.style.cursor = "pointer";
                toggleButton.style.border = "1px solid #007BFF"; // Blue outline for visibility
                toggleButton.style.borderRadius = "3px";
                toggleButton.style.backgroundColor = "#f0f8ff"; // Light blue background
                toggleButton.style.color = "#007BFF"; // Blue text for better contrast

                // Add the toggle button to the graph container
                graphContainer.appendChild(toggleButton);

                // Add the graph container to the main container
                container.appendChild(graphContainer);

                // Render the graph layout
                graphElement.renderLayout(currentInstanceLayout).then(() => {
                    console.log("Graph layout rendered");

                    // Mount additional React components after rendering
                    if (window.mountErrorMessageModal) {
                        console.log("Mounting Error Message Modal");
                        window.mountErrorMessageModal(errorDiv.id);
                    }
                }).catch((err) => {
                    console.error("Error rendering graph layout:", err);
                });

                // Toggle visibility of the graph element
                toggleButton.addEventListener("click", () => {
                    const isCollapsed = graphElement.style.display === "none";
                    graphElement.style.display = isCollapsed ? "block" : "none";
                    toggleButton.textContent = isCollapsed ? "-" : "+"; // Update button text
                });

            } catch (error) {
                console.error("Error in genlayout:", error);

                // Display the error in the errorDiv
                errorDiv.style.color = "red";
                errorDiv.style.padding = "10px";
                errorDiv.style.border = "1px solid red";
                errorDiv.style.marginBottom = "10px";
                errorDiv.textContent = `Error: ${error.message || error}`;
            }

            return container;
        }


        /***** Input FROM a layout. This is still experimental and so hidden behind a key-binding. ********/


        /*** Styling helpers */

        function applyOverlayStyles(overlay) {
            overlay.style.position = "fixed";
            overlay.style.top = "0";
            overlay.style.left = "0";
            overlay.style.width = "100vw"; // Full width of the viewport
            overlay.style.height = "100vh"; // Full height of the viewport
            overlay.style.backgroundColor = "rgba(0, 0, 0, 0.5)"; // Semi-transparent background
            overlay.style.zIndex = "10000"; // Ensure it appears above other elements
            overlay.style.display = "flex";
            overlay.style.justifyContent = "center";
            overlay.style.alignItems = "center";
        }

        function applyContainerStyles(container) {
            container.style.background = "white";
            container.style.border = "1px solid #ccc";
            container.style.padding = "20px";
            container.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
            container.style.width = "80vw";
            container.style.borderRadius = "8px";
            container.style.maxHeight = "90vh"; // Limit the height to 90% of the viewport
            container.style.overflowY = "auto"; // Enable vertical scrolling if content overflows
        }

        function applyButtonContainerStyles(buttonContainer) {
            buttonContainer.style.display = "flex";
            buttonContainer.style.justifyContent = "flex-end";
        }
        /********** */


        const INPUT_KEYBINDING = "Ctrl-Alt-I";

        // This is the main function for input mode.
        function geninput(dataInstance, cndSpec) {
            return new Promise((resolve, reject) => {
                // Create the overlay container
                const overlay = document.createElement("div");
                applyOverlayStyles(overlay);
                const cleanupHandlers = [];
                const runCleanup = () => {
                    cleanupHandlers.forEach((cleanupFn) => {
                        try {
                            cleanupFn();
                        } catch (cleanupErr) {
                            console.warn("Cleanup error:", cleanupErr);
                        }
                    });
                };

                // Create the input container
                const container = document.createElement("div");
                applyContainerStyles(container);

                // TODO: This seems superfluous from a text standpoint.
                const title = document.createElement("h3");
                title.textContent = "Input";
                title.style.marginTop = "0";
                container.appendChild(title);

                // Create the input area
                const combinedInputDiv = document.createElement("div");
                combinedInputDiv.id = "combined-input-container-" + Math.random().toString(36).slice(2);
                combinedInputDiv.style.overflow = "auto";
                combinedInputDiv.style.marginBottom = "10px";
                container.appendChild(combinedInputDiv);

                // Add buttons
                const buttonContainer = document.createElement("div");
                applyButtonContainerStyles(buttonContainer);


                // These should be better styled, and maybe at the top?
                const doneButton = document.createElement("button");
                doneButton.innerText = "Done";
                doneButton.style.marginRight = "10px";

                const cancelButton = document.createElement("button");
                cancelButton.innerText = "Cancel";

                buttonContainer.appendChild(doneButton);
                buttonContainer.appendChild(cancelButton);
                container.appendChild(buttonContainer);

                // Append the container to the overlay
                overlay.appendChild(container);
                document.body.appendChild(overlay);

                // Cancel button functionality
                cancelButton.onclick = () => {
                    runCleanup();
                    document.body.removeChild(overlay);
                    reject("cancelled");
                };

                // Done button functionality
                doneButton.onclick = () => {
                    try {
                        const core = getSpytialCore();
                        const getCurrentPyretInstance =
                            core.getCurrentPyretInstanceFromReact ||
                            window.getCurrentPyretInstanceFromReact ||
                            window.getCurrentPyretInstance;
                        const latestInstance = typeof getCurrentPyretInstance === "function"
                            ? getCurrentPyretInstance()
                            : dataInstance;

                        if (!latestInstance || typeof latestInstance.reify !== "function") {
                            throw new Error("dataInstance.reify() is not available");
                        }
                        const result = latestInstance.reify();
                        runCleanup();
                        document.body.removeChild(overlay);
                        resolve(result);
                    } catch (err) {
                        reject(err);
                    }
                };

                // Initialize the input logic
                try {
                    const core = getSpytialCore();
                    const pyretREPLInternal = window.__internalRepl;
                    const mountPyretRepl = core.mountPyretRepl || window.mountPyretRepl;

                    if (typeof mountPyretRepl !== "function") {
                        throw new Error("spytial-core mountPyretRepl API is unavailable");
                    }

                    const workspace = document.createElement("div");
                    workspace.style.display = "flex";
                    workspace.style.flexWrap = "wrap";
                    workspace.style.gap = "12px";
                    workspace.style.alignItems = "stretch";
                    workspace.style.minHeight = "520px";
                    combinedInputDiv.appendChild(workspace);

                    const replContainer = document.createElement("div");
                    replContainer.id = "pyret-repl-container-" + Math.random().toString(36).slice(2);
                    replContainer.style.flex = "1 1 340px";
                    replContainer.style.minWidth = "340px";
                    workspace.appendChild(replContainer);

                    const previewContainer = document.createElement("div");
                    previewContainer.style.flex = "1 1 340px";
                    previewContainer.style.minWidth = "340px";
                    previewContainer.style.border = "1px solid #ddd";
                    previewContainer.style.borderRadius = "6px";
                    previewContainer.style.padding = "8px";
                    previewContainer.style.backgroundColor = "#fff";
                    previewContainer.style.display = "flex";
                    previewContainer.style.flexDirection = "column";
                    workspace.appendChild(previewContainer);

                    const previewLabel = document.createElement("div");
                    previewLabel.textContent = "Preview";
                    previewLabel.style.fontWeight = "bold";
                    previewLabel.style.fontSize = "12px";
                    previewLabel.style.marginBottom = "8px";
                    previewContainer.appendChild(previewLabel);

                    const graphElement = document.createElement("webcola-cnd-graph");
                    graphElement.setAttribute("width", "460");
                    graphElement.setAttribute("height", "460");
                    graphElement.style.minHeight = "460px";
                    graphElement.style.display = "block";
                    graphElement.style.margin = "0 auto";
                    previewContainer.appendChild(graphElement);

                    const previewError = document.createElement("div");
                    previewError.style.marginTop = "8px";
                    previewError.style.fontSize = "12px";
                    previewError.style.color = "#a94442";
                    previewContainer.appendChild(previewError);

                    const refreshPreview = (instanceOverride) => {
                        const getCurrentPyretInstance =
                            core.getCurrentPyretInstanceFromReact ||
                            window.getCurrentPyretInstanceFromReact ||
                            window.getCurrentPyretInstance;
                        const currentInstance = instanceOverride ||
                            (typeof getCurrentPyretInstance === "function" ? getCurrentPyretInstance() : null) ||
                            dataInstance;

                        if (!currentInstance) {
                            return;
                        }

                        previewError.textContent = "";
                        renderPyretLayoutPreview(core, graphElement, currentInstance, cndSpec).catch((renderErr) => {
                            previewError.textContent = `Preview update failed: ${renderErr.message || renderErr}`;
                            console.error("Error rendering preview graph:", renderErr);
                        });
                    };

                    const mounted = mountPyretRepl(replContainer.id, {
                        initialInstance: dataInstance,
                        externalEvaluator: pyretREPLInternal
                    });

                    if (!mounted) {
                        throw new Error("Failed to mount Pyret REPL");
                    }

                    const onInstanceChanged = (event) => {
                        const eventInstance = event?.detail?.instance;
                        if (eventInstance) {
                            refreshPreview(eventInstance);
                        }
                    };

                    window.addEventListener("pyret-instance-changed", onInstanceChanged);
                    cleanupHandlers.push(() => {
                        window.removeEventListener("pyret-instance-changed", onInstanceChanged);
                    });

                    refreshPreview(dataInstance);
                } catch (err) {
                    container.textContent = `Error: ${err.message || err}`;
                    reject(err);
                }
            });
        }

        /**
         * Attaches a keybinding to the active CodeMirror instance and executes a thunk when triggered.
         *
         * @param {string} keyBinding - The keybinding to attach (e.g., "Cmd-Shift-R").
         * @param {function} thunk - A function that returns a string or a promise of a string.
         *                           The result of the thunk will replace the text at the cursor.
         *
         * @example
         * // Define a thunk that returns a string
         * function exampleThunk() {
         *     return "Hello, CodeMirror!";
         * }
         *
         * // Attach the keybinding to CodeMirror
         * attachToCM("Cmd-Shift-R", exampleThunk);
         */
        function attachToCM(keyBinding, thunk) {
            // Step 1: Find the active CodeMirror instance
            const cmEl = document.activeElement.closest(".CodeMirror") || document.querySelector(".CodeMirror");
            const cm = cmEl?.CodeMirror;

            if (!cm) {
                console.warn("❌ No CodeMirror editor found.");
                return;
            }

            // Step 2: Add the keybinding using addKeyMap
            const keyMap = {
                [keyBinding]: async function (cmInstance) {
                    try {
                        // Call the thunk to get the result (string or promise of a string)
                        const result = await thunk();

                        // Replace the text at the cursor with the result (only if the promise resolves)
                        if (result !== undefined && result !== null) {
                            cmInstance.replaceSelection(result);
                        }
                    } catch (err) {
                        if (err === "cancelled") {
                            console.log("Operation cancelled by the user. No changes made.");
                        } else {
                            console.error("Error in thunk execution:", err);
                        }
                    }
                }
            };
            cm.addKeyMap(keyMap);
        }


        attachToCM(INPUT_KEYBINDING, async () => {
            try {
                const cmEl = document.activeElement.closest(".CodeMirror") || document.querySelector(".CodeMirror");
                const cm = cmEl?.CodeMirror;
                if (!cm) throw new Error("No active CodeMirror instance");
                const core = getSpytialCore();

                const cursorCoords = cm.cursorCoords(true, "page");

                let cndSpec = "";
                let dataInstance = undefined;
                const selectedText = cm.getSelection();
                if (selectedText != null && selectedText !== undefined && selectedText !== "") {
                    // If there IS selected text, we should use that to build the data instance, by passing
                    // it to the evaluator.
                    function removeOuterQuotes(str) {
                        // Check if the string starts and ends with quotes
                        if (str.startsWith('"') && str.endsWith('"')) {
                            // Remove the outermost quotes
                            return str.slice(1, -1);
                        }
                        return str; // Return the string unchanged if no outer quotes
                    }

                    const cndSpecExpr = `(${selectedText})._cndspec()`;
                    const intermediatePyretDataInst = await core.PyretDataInstance.fromExpression(
                        cndSpecExpr,
                        {},
                        window.__internalRepl
                    );
                    // Get the CnD spec from the selected text. This is super hacky, may be better to actually begin with the 
                    // EVALUATION of the selected text.
                    cndSpec = removeOuterQuotes(intermediatePyretDataInst.reify());


                    dataInstance = await core.PyretDataInstance.fromExpression(selectedText, {}, window.__internalRepl);
                } else {
                    // Else, we create a new data instance with no value.
                    dataInstance = new core.PyretDataInstance(null, {}, window.__internalRepl);
                }

                const result = await geninput(dataInstance, cndSpec, cursorCoords);
                return result;
                //return JSON.stringify(result, null, 2);
            } catch (err) {
                console.error("Error invoking geninput:", err);
                return "#Error: " + (err.message || err);
            }
        });


        return runtime.makeModuleReturn({
            genlayout: runtime.makeFunction(genlayout)
        }, {});
    }
})
