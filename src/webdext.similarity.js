;(function(undefined) {
    "use strict";

    // imports
    var DATA_TYPE = Webdext.Model.DATA_TYPE,
        sequenceEditDistance = Webdext.Sequal.editDistance;

    var WEIGHTS = {
        DATA_TYPE: 1,
        DATA_CONTENT: 0.64,
        TAG_PATH: 0.48,
        PRESENTATION_STYLE: 0.81,
        RECTANGLE_SIZE: 0.81
    };
    var TOTAL_WEIGHTS = {
        TEXT: WEIGHTS.DATA_TYPE + WEIGHTS.DATA_CONTENT + WEIGHTS.TAG_PATH + WEIGHTS.PRESENTATION_STYLE,
        HYPERLINK: WEIGHTS.DATA_TYPE + WEIGHTS.DATA_CONTENT + WEIGHTS.TAG_PATH + WEIGHTS.PRESENTATION_STYLE,
        IMAGE: WEIGHTS.DATA_TYPE + WEIGHTS.DATA_CONTENT + WEIGHTS.TAG_PATH + WEIGHTS.RECTANGLE_SIZE
    };
    var THRESHOLDS = {
        LEAF_NODE: 0.7,
        TREE: 0.5,
    };

    var treeClusterMap = new Map();

    function dotProduct(tfv1, tfv2) {
        var terms1 = Object.keys(tfv1),
            terms2 = Object.keys(tfv2),
            longerTerms = terms1,
            shorterTerms = terms2,
            terms1Length = terms1.length,
            terms2Length = terms2.length,
            shorterTermsLength = terms2Length;

        if (terms1Length < terms2Length) {
            longerTerms = terms2;
            shorterTerms = terms1;
            shorterTermsLength = terms1Length;
        }

        var dotProduct = 0;
        for (var i=shorterTermsLength; i--; ) {
            var term = shorterTerms[i];
            if (longerTerms.indexOf(term) > -1) {
                dotProduct += tfv1[term] * tfv2[term];
            }
        }

        return dotProduct;
    }

    function cosineSimilarity(wNode1, wNode2) {
        var tfv1 = wNode1.termFrequencyVector,
            tfv2 = wNode2.termFrequencyVector,
            dp = dotProduct(tfv1, tfv2);

        if (dp === 0) {
            return 0;
        }

        return dp / (wNode1.normVector * wNode2.normVector);
    }

    function urlSimilarity(url1, url2) {
        if (url1 === null && url2 === null) {
            return 1;
        } else if (url1 === null || url2 === null) {
            return 0;
        }

        var hostNameSimilarity = url1.hostname === url2.hostname ? 1 : 0;
        var pathNameEditDistance = sequenceEditDistance(url1.pathname, url2.pathname);
        var normalizedEditDistance = pathNameEditDistance / (
            url1.pathname.length + url2.pathname.length
        );
        var pathNameSimilarity = 1 - normalizedEditDistance;

        return (hostNameSimilarity + pathNameSimilarity) / 2;
    }

    function tagPathSubstitutionCost(e1, e2) {
        if (e1.valueOf() === e2.valueOf()) {
            return 0;
        } else {
            return 2;
        }
    }

    function tagPathInsertionCost() {
        return 1;
    }

    function tagPathDeletionCost() {
        return 1;
    }

    function tagPathEditDistance(tp1, tp2) {
        return sequenceEditDistance(
            tp1,
            tp2,
            tagPathSubstitutionCost,
            tagPathInsertionCost,
            tagPathDeletionCost
        );
    }

    function tagPathSimilarity(tp1, tp2) {
        if (tp1.length === 0 && tp2.length === 0) {
            return 1;
        }

        var editDistance = tagPathEditDistance(tp1, tp2);

        return 1.0 - (editDistance / (tp1.length + tp2.length));
    }

    function presentationStyleSimilarity(ps1, ps2) {
        var styles = Object.keys(ps1);
        var stylesLength = styles.length,
            similarStylesCount = 0;

        for (var i=stylesLength; i--; ) {
            var style = styles[i];
            if (ps1[style] === ps2[style]) {
                similarStylesCount++;
            }
        }

        return similarStylesCount / stylesLength;
    }

    function rectangleSizeSimilarity(rs1, rs2) {
        var normalizedWidthDiff = Math.abs(rs1.width - rs2.width) / Math.max(rs1.width, rs2.width);
        var normalizedHeightDiff = Math.abs(rs1.height - rs2.height) / Math.max(rs1.height, rs2.height);

        return 1 - ((normalizedWidthDiff + normalizedHeightDiff) / 2);
    }

    function wElementNodeSimilarity(wen1, wen2) {
        return wen1.tagName === wen2.tagName ? 1 : 0;
    }

    function wTextNodeSimilarity(wtn1, wtn2) {
        var cosineSim = cosineSimilarity(wtn1, wtn2);
        var weightedCosineSim = cosineSim * WEIGHTS.DATA_CONTENT;

        var tagPathSim = tagPathSimilarity(wtn1.tagPath, wtn2.tagPath);
        var weightedTagPathSim = tagPathSim * WEIGHTS.TAG_PATH;

        var psSim = presentationStyleSimilarity(wtn1.presentationStyle, wtn2.presentationStyle);
        var weightedPSSim = psSim * WEIGHTS.PRESENTATION_STYLE;

        var totalSim = weightedCosineSim + weightedTagPathSim + weightedPSSim + WEIGHTS.DATA_TYPE;

        return totalSim / TOTAL_WEIGHTS.TEXT;
    }

    function wHyperlinkNodeSimilarity(whn1, whn2) {
        var urlSim = urlSimilarity(whn1.href, whn2.href);
        var weightedUrlSim = urlSim * WEIGHTS.DATA_CONTENT;

        var tagPathSim = tagPathSimilarity(whn1.tagPath, whn2.tagPath);
        var weightedTagPathSim = tagPathSim * WEIGHTS.TAG_PATH;

        var psSim = presentationStyleSimilarity(whn1.presentationStyle, whn2.presentationStyle);
        var weightedPSSim = psSim * WEIGHTS.PRESENTATION_STYLE;

        var totalSim = weightedUrlSim + weightedTagPathSim + weightedPSSim + WEIGHTS.DATA_TYPE;

        return totalSim / TOTAL_WEIGHTS.HYPERLINK;
    }

    function wImageNodeSimilarity(win1, win2) {
        var urlSim = urlSimilarity(win1.src, win2.src);
        var weightedUrlSim = urlSim * WEIGHTS.DATA_CONTENT;

        var tagPathSim = tagPathSimilarity(win1.tagPath, win2.tagPath);
        var weightedTagPathSim = tagPathSim * WEIGHTS.TAG_PATH;

        var rsSim = rectangleSizeSimilarity(win1.rectangleSize, win2.rectangleSize);
        var weightedRSSim = rsSim * WEIGHTS.RECTANGLE_SIZE;

        var totalSim = weightedUrlSim + weightedTagPathSim + weightedRSSim + WEIGHTS.DATA_TYPE;

        return totalSim / TOTAL_WEIGHTS.IMAGE;
    }


    function wNodeSimilarity(wNode1, wNode2) {
        if (wNode1.dataType !== wNode2.dataType) {
            return 0;
        }

        if (wNode1.dataType === DATA_TYPE.TEXT) {
            return wTextNodeSimilarity(wNode1, wNode2);
        } else if (wNode1.dataType === DATA_TYPE.HYPERLINK) {
            return wHyperlinkNodeSimilarity(wNode1, wNode2);
        } else if (wNode1.dataType === DATA_TYPE.IMAGE) {
            return wImageNodeSimilarity(wNode1, wNode2);
        } else {
            return wElementNodeSimilarity(wNode1, wNode2);
        }
    }

    function SimilarityMap(similarityFunction) {
        this.map = new Map();
        this.similarityFunction = similarityFunction;
    }
    SimilarityMap.prototype.get = function(wNode1, wNode2) {
        if (this.map.has(wNode1) && this.map.get(wNode1).has(wNode2)) {
            return this.map.get(wNode1).get(wNode2);
        } else if (this.map.has(wNode2) && this.map.get(wNode2).has(wNode1)) {
            return this.map.get(wNode2).get(wNode1);
        }

        var similarity = this.similarityFunction(wNode1, wNode2);
        if (this.map.has(wNode1)) {
            this.map.get(wNode1).set(wNode2, similarity);
        } else if (this.map.has(wNode2)) {
            this.map.get(wNode2).set(wNode1, similarity);
        } else {
            var innerMap = new Map();
            innerMap.set(wNode2, similarity);
            this.map.set(wNode1, innerMap);
        }

        return similarity;
    };

    function getValueFromSimPairMap(map, e1, e2) {
        if (map.has(e1) && map.get(e1).has(e2)) {
            return map.get(e1).get(e2);
        } else if (map.has(e2) && map.get(e2).has(e1)) {
            return map.get(e2).get(e1);
        }
    }

    var wNodeSimilarityMap = new SimilarityMap(wNodeSimilarity);

    function memoizedWNodeSimilarity(wNode1, wNode2) {
        return wNodeSimilarityMap.get(wNode1, wNode2);
    }

    /*
    * Complexity = cluster1.length * cluster2.length
    */
    function clusterSimilarity(cluster1, cluster2, dataSimilarityFunc) {
        var sum = 0,
            cluster1Length = cluster1.length,
            cluster2Length = cluster2.length;

        for (var i=cluster1Length; i--; ) {
            for (var j=cluster2Length; j--; ) {
                sum += dataSimilarityFunc(cluster1[i], cluster2[j]);
            }
        }

        return sum / (cluster1Length * cluster2Length);
    }

    function cluster(
        data, similarityThreshold, clusterSimilarityFunc, dataSimilarityFunc
    ) {
        var clusters = [],
            dataLength = data.length,
            simPairMap = new Map();

        for (var i=0; i < dataLength; i++) {
            clusters.push([data[i]]);            
        }

        // @EXPERIMENTAL
        if (dataLength === 1 || dataLength > 100) {
            return clusters;
        }

        var clusterType = "wTree";
        if (dataSimilarityFunc === memoizedWNodeSimilarity) {
            clusterType = "wNode";
        }

        // get distance for all possible pairs
        // consider removing this and rely on memoization
        for (i=0; i < dataLength-1; i++) {
            var innerMap = new Map();

            for (var j=i+1; j < dataLength; j++) {
                var similarity = dataSimilarityFunc(data[i], data[j]);
                innerMap.set(data[j], similarity);
            }

            simPairMap.set(data[i], innerMap);
        }

        // get nearest neighbor for each 1-element cluster
        var nearestNeighbors = new Map();
        for (i=0; i < dataLength; i++) {
            var maxSimilarity = Number.MIN_VALUE,
                nnIndex = i;

            for (j=0; j < dataLength; j++) {
                if (i !== j) {
                    var currSimilarity = getValueFromSimPairMap(
                        simPairMap,
                        data[i],
                        data[j]
                    );
                    if (currSimilarity > maxSimilarity) {
                        maxSimilarity = currSimilarity;
                        nnIndex = j;
                    }
                }
            }

            nearestNeighbors.set(
                clusters[i],
                {cluster: clusters[nnIndex], similarity: maxSimilarity}
            );
        }

        var csf = function(c1, c2) {
            return clusterSimilarityFunc(c1, c2, dataSimilarityFunc);
        };
        var clusterSimMap = new SimilarityMap(csf);

        while (clusters.length > 1) {
            var maxSimilarity = Number.MIN_VALUE,
                toMerge1 = null,
                toMerge2 = null,
                nearestNeighborsSize = nearestNeighbors.size;

            // find pair with maximum similarity
            for (i=nearestNeighborsSize; i--; ) {
                var nn = nearestNeighbors.values[i];

                if (nn.similarity > maxSimilarity) {
                    toMerge1 = nearestNeighbors.keys[i];
                    toMerge2 = nn.neighbor;
                    maxSimilarity = nn.similarity;
                }
            }

            // stop clustering
            if (maxSimilarity <= similarityThreshold) {
                break;
            }

            // merging
            clusters.splice(clusters.indexOf(toMerge2), 1);
            toMerge1.push.apply(toMerge1, toMerge2);
            nearestNeighbors.delete(toMerge2);

            // find clusters whose nearest neighbor may be affected by merging
            var affectedClusters = [],
                newClusterLength = clusters.length;

            for (i=newClusterLength; i--; ) {
                var c = clusters[i];
                if (c !== toMerge1) {
                    var nn = nearestNeighbors.get(c).neighbor;
                    if (nn === toMerge1 || nn === toMerge2) {
                        affectedClusters.push(c);
                    }
                }
            }

            affectedClusters.push(toMerge1);
            var acLength = affectedClusters.length;

            // update nearest neighbor for affected cluster
            for (i=acLength; i--; ) {
                var ac = affectedClusters[i],
                    maxSimilarity = Number.MIN_VALUE,
                    nnIndex;

                for (j=newClusterLength; j--; ) {
                    if (ac !== clusters[j]) {
                        var currSimilarity = clusterSimMap.get(ac, clusters[j]);
                        if (currSimilarity > maxSimilarity) {
                            maxSimilarity = currSimilarity;
                            nnIndex = j;
                        }
                    }
                }

                nearestNeighbors.set(
                    ac,
                    {cluster: clusters[nnIndex], similarity: maxSimilarity}
                );
            }
        }

        return clusters;
    }

    function clusterWNodes(wNodeSet, similarityThreshold) {
        if (typeof similarityThreshold === "undefined") {
            similarityThreshold = THRESHOLDS.LEAF_NODE;
        }

        var wTextNodes = [],
            wHyperlinkNodes = [],
            wImageNodes = [],
            wElementNodes = [],
            wNodeSetLength = wNodeSet.length;

        for (var i=0; i < wNodeSetLength; i++) {
            var wNode = wNodeSet[i];

            if (wNode.dataType === DATA_TYPE.TEXT) {
                wTextNodes.push(wNode);
            } else if (wNode.dataType === DATA_TYPE.HYPERLINK) {
                wHyperlinkNodes.push(wNode);
            } else if (wNode.dataType === DATA_TYPE.IMAGE) {
                wImageNodes.push(wNode);
            } else {
                wElementNodes.push(wNode);
            }
        }

        if (wTextNodes.length > 0) {
            var textClusters = cluster(
                wTextNodes,
                similarityThreshold,
                clusterSimilarity,
                memoizedWNodeSimilarity
            );
        }

        if (wHyperlinkNodes.length > 0) {
            var hyperlinkClusters = cluster(
                wHyperlinkNodes,
                similarityThreshold,
                clusterSimilarity,
                memoizedWNodeSimilarity
            );
        }

        if (wImageNodes.length > 0) {
            var imageClusters = cluster(
                wImageNodes,
                similarityThreshold,
                clusterSimilarity,
                memoizedWNodeSimilarity
            );
        }

        if (wElementNodes.length > 0) {
            var elementClusters = cluster(
                wElementNodes,
                similarityThreshold,
                clusterSimilarity,
                memoizedWNodeSimilarity
            );
        }

        var clusters = [];
        clusters.push.apply(clusters, textClusters);
        clusters.push.apply(clusters, hyperlinkClusters);
        clusters.push.apply(clusters, imageClusters);
        clusters.push.apply(clusters, elementClusters);

        return clusters;
    }

    /**
    * Complexity: 
    */
    function wTreeSimilarity(wTree1, wTree2) {
        var leafNodes1 = [],
            leafNodes2 = [];

        if (Array.isArray(wTree1)) {
            for (var i=0, wTree1Length=wTree1.length; i < wTree1Length; i++) {
                leafNodes1.push.apply(leafNodes1, wTree1[i].getLeafNodes());
            }
        } else {
            leafNodes1 = wTree1.getLeafNodes();
        }

        if (Array.isArray(wTree2)) {
            for (var i=0, wTree2Length=wTree2.length; i < wTree2Length; i++) {
                leafNodes2.push.apply(leafNodes2, wTree2[i].getLeafNodes());
            }
        } else {
            leafNodes2 = wTree2.getLeafNodes();
        }

        var leafNodes1Length = leafNodes1.length,
            leafNodes2Length = leafNodes2.length;

        for (var i=leafNodes1Length; i--; ) {
            leafNodes1[i].inTree1 = true;
        }

        for (i=leafNodes2Length; i--; ) {
            leafNodes2[i].inTree1 = false;
        }

        var diffProportion = Math.min(
                leafNodes1Length, leafNodes2Length
            ) / Math.max(leafNodes1Length, leafNodes2Length);

        if (diffProportion < THRESHOLDS.TREE) {
            return diffProportion;
        }

        var leafNodesSet = leafNodes1.concat(leafNodes2);
        var leafNodeClusters = clusterWNodes(leafNodesSet);
        var leafNodeClustersLength = leafNodeClusters.length,
            nOfCluster1 = 0,
            nOfCluster2 = 0,
            nOfCluster1And2 = 0;

        for (i=leafNodeClustersLength; i--; ) {
            var cluster = leafNodeClusters[i];
            var containsTree1Node = cluster.some(function(wNode) {
                return wNode.inTree1;
            });
            var containsTree2Node = cluster.some(function(wNode) {
                return !wNode.inTree1;
            });
            var containsBoth = containsTree1Node && containsTree2Node;

            if (containsBoth) {
                nOfCluster1++;
                nOfCluster2++;
                nOfCluster1And2++;
            } else if (containsTree1Node) {
                nOfCluster1++;
            } else if (containsTree2Node) {
                nOfCluster2++;
            }
        }

        for (i=leafNodes1Length+leafNodes2Length; i--; ) {
            delete leafNodesSet[i].inTree1;
        }

        return nOfCluster1And2 / Math.max(nOfCluster1, nOfCluster2);
    }

    var wTreeSimilarityMap = new SimilarityMap(wTreeSimilarity);

    function memoizedWTreeSimilarity(wTree1, wTree2) {
        return wTreeSimilarityMap.get(wTree1, wTree2);
    }

    function filterTreeClusters(clusters, wNodeSet) {
        var clustersLength = clusters.length,
            filteredClusters = [];

        for (var i=0; i < clustersLength; i++) {
            var cluster = clusters[i],
                clusterLength = cluster.length;

            for (var j=0; j < clusterLength; j++) {
                if (wNodeSet.indexOf(cluster[j]) > -1) {
                    filteredClusters.push(cluster);
                    break;
                }
            }
        }

        return filteredClusters;
    }

    function clusterWTrees(wNodeSet, similarityThreshold) {
        var parent = wNodeSet[0].parent;
        var clusters = treeClusterMap.get(parent);

        if (clusters) {
            if (parent.getChildrenCount() === wNodeSet.length) {
                return clusters;
            } else {
                return filterTreeClusters(clusters, wNodeSet);
            }
        }

        if (typeof similarityThreshold === "undefined") {
            similarityThreshold = THRESHOLDS.TREE;
        }

        clusters = cluster(
            wNodeSet,
            similarityThreshold,
            clusterSimilarity,
            memoizedWTreeSimilarity
        );
        
        if (parent.getChildrenCount() === wNodeSet.length) {
            treeClusterMap.put(parent, clusters);
        }

        return clusters;
    }

    // exports
    Webdext.Similarity = {
        THRESHOLDS: THRESHOLDS,

        dotProduct: dotProduct,
        cosineSimilarity: cosineSimilarity,
        urlSimilarity: urlSimilarity,
        tagPathEditDistance: tagPathEditDistance,
        tagPathSimilarity: tagPathSimilarity,
        presentationStyleSimilarity: presentationStyleSimilarity,
        rectangleSizeSimilarity: rectangleSizeSimilarity,

        SimilarityMap: SimilarityMap,
        getValueFromSimPairMap: getValueFromSimPairMap,

        wElementNodeSimilarity: wElementNodeSimilarity,
        wTextNodeSimilarity: wTextNodeSimilarity,
        wHyperlinkNodeSimilarity: wHyperlinkNodeSimilarity,
        wImageNodeSimilarity: wImageNodeSimilarity,
        wNodeSimilarity: wNodeSimilarity,
        memoizedWNodeSimilarity: memoizedWNodeSimilarity,
        wTreeSimilarity: wTreeSimilarity,
        memoizedWTreeSimilarity: memoizedWTreeSimilarity,

        clusterSimilarity: clusterSimilarity,
        cluster: cluster,
        clusterWNodes: clusterWNodes,
        filterTreeClusters: filterTreeClusters,
    };
}).call(this);