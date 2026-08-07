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
            const layoutResult = layoutInstance.generateLayout(dataInstance);
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
                const layoutResult = layoutInstance.generateLayout(dataInstance);
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


        return runtime.makeModuleReturn({
            genlayout: runtime.makeFunction(genlayout)
        }, {});
    }
})
