class WaveCollapseRealLandscapeScene extends Phaser.Scene {
    constructor() {
        super("WaveCollapseRealLandscapeScene");
    }

    preload() {
        // Load the tileset image (adjust the path if needed)
        this.load.image('tileset', './assets/mapPack_spritesheet.png');
    }

    create() {
        this.mapWidth = 20;
        this.mapHeight = 15;
        this.tileSize = 64;
        // Delay (in ms) between each step of the generation
        this.generationDelay = 20;

        // We use five terrain types:
        // - water (56), sand (110), grass (40), mountain (165), snow (50)
        this.tileIndices = {
            water: 56,
            sand: 110,
            grass: 40,
            mountain: 165,
            snow: 50
        };

        this.tileTypes = ["water", "sand", "grass", "mountain", "snow"];


        // - snowman: 7, tree: 103, cactus: 53
        this.decorationIndices = {
            snowman: 7,
            tree: 103,
            cactus: 53
        };


        this.allowed = {
            water: {
                up: ["water", "sand"],
                down: ["water", "sand"],
                left: ["water", "sand"],
                right: ["water", "sand"]
            },
            sand: {
                up: ["water", "sand", "grass"],
                down: ["water", "sand", "grass"],
                left: ["water", "sand", "grass"],
                right: ["water", "sand", "grass"]
            },
            grass: {
                up: ["sand", "grass", "mountain"],
                down: ["sand", "grass", "mountain"],
                left: ["sand", "grass", "mountain"],
                right: ["sand", "grass", "mountain"]
            },
            mountain: {
                up: ["grass", "mountain", "snow"],
                down: ["grass", "mountain", "snow"],
                left: ["grass", "mountain", "snow"],
                right: ["grass", "mountain", "snow"]
            },
            snow: {
                up: ["mountain", "snow"],
                down: ["mountain", "snow"],
                left: ["mountain", "snow"],
                right: ["mountain", "snow"]
            }
        };


        this.map = this.make.tilemap({
            tileWidth: this.tileSize,
            tileHeight: this.tileSize,
            width: this.mapWidth,
            height: this.mapHeight
        });
        this.tileset = this.map.addTilesetImage('terrain', 'tileset');
        this.layer = this.map.createBlankLayer('layer', this.tileset);
        // Create a decoration layer on top.
        this.decorationLayer = this.map.createBlankLayer('decorations', this.tileset);


        this.grid = [];
        for (let y = 0; y < this.mapHeight; y++) {
            this.grid[y] = [];
            for (let x = 0; x < this.mapWidth; x++) {
                this.grid[y][x] = {
                    possibilities: [...this.tileTypes],
                    collapsed: false
                };
            }
        }

        // ========================================================
        // Directions and Propagation Queue
        // ========================================================
        this.directions = [
            { name: "up",    dx: 0,  dy: -1 },
            { name: "down",  dx: 0,  dy: 1 },
            { name: "left",  dx: -1, dy: 0 },
            { name: "right", dx: 1,  dy: 0 }
        ];
        this.propagationQueue = [];


        const startX = Math.floor(this.mapWidth / 2);
        const startY = Math.floor(this.mapHeight / 2);
        const startCell = this.grid[startY][startX];
        const chosenType = Phaser.Utils.Array.GetRandom(startCell.possibilities);
        startCell.possibilities = [chosenType];
        startCell.collapsed = true;
        this.layer.putTileAt(this.tileIndices[chosenType], startX, startY);
        this.enqueueNeighbors(startX, startY);


        this.timerEvent = this.time.addEvent({
            delay: this.generationDelay,
            callback: this.stepWFC,
            callbackScope: this,
            loop: true
        });


        // Restart: Press R to regenerate the map.
        this.input.keyboard.on('keydown-R', () => {
            this.scene.restart();
        });
    }

    // Helper: return the opposite direction.
    getOppositeDirection(dir) {
        switch(dir) {
            case "up": return "down";
            case "down": return "up";
            case "left": return "right";
            case "right": return "left";
            default: return "";
        }
    }

    // Helper: intersection of two arrays.
    intersection(arr1, arr2) {
        return arr1.filter(x => arr2.includes(x));
    }

    // Update the constraints on the cell at (x, y) based on all its collapsed neighbors.
    updateConstraints(x, y) {
        let cell = this.grid[y][x];
        let allowedSet = cell.possibilities; // Start with current possibilities.
        // For every neighbor that is collapsed, get its allowed edge (using the opposite direction).
        for (const d of this.directions) {
            const nx = x + d.dx;
            const ny = y + d.dy;
            if (nx < 0 || nx >= this.mapWidth || ny < 0 || ny >= this.mapHeight) continue;
            let neighbor = this.grid[ny][nx];
            if (neighbor.collapsed) {
                let neighborType = neighbor.possibilities[0]; // the neighbor's tile type
                const opp = this.getOppositeDirection(d.name);
                let allowedFromNeighbor = this.allowed[neighborType][opp];
                allowedSet = this.intersection(allowedSet, allowedFromNeighbor);
            }
        }
        cell.possibilities = this.intersection(cell.possibilities, allowedSet);
        return cell.possibilities;
    }

    // Enqueue all non-collapsed neighbors of the cell at (x, y).
    enqueueNeighbors(x, y) {
        for (const d of this.directions) {
            const nx = x + d.dx;
            const ny = y + d.dy;
            if (nx < 0 || nx >= this.mapWidth || ny < 0 || ny >= this.mapHeight) continue;
            if (!this.grid[ny][nx].collapsed) {
                this.propagationQueue.push({ x: nx, y: ny });
            }
        }
    }

    // Process a single propagation task: update constraints for the cell and collapse it if only one possibility remains.
    processTask(x, y) {
        let cell = this.grid[y][x];
        if (cell.collapsed) return;
        const valid = this.updateConstraints(x, y);
        if (valid.length === 1) {
            cell.collapsed = true;
            const chosen = valid[0];
            cell.possibilities = [chosen];
            this.layer.putTileAt(this.tileIndices[chosen], x, y);
            this.enqueueNeighbors(x, y);
        }
    }

    // Main WFC step: process a propagation task if available; otherwise, collapse the lowest-entropy cell.
    stepWFC() {
        if (this.propagationQueue.length > 0) {
            let task = this.propagationQueue.shift();
            this.processTask(task.x, task.y);
        } else {
            let candidate = this.findLowestEntropyCell();
            if (!candidate) {
                this.timerEvent.remove();
                console.log("Map generation complete!");
                // Once the map is complete, add decorations.
                this.addDecorations();
                return;
            }
            const { x, y } = candidate;
            const cell = this.grid[y][x];
            // Update constraints first.
            let valid = this.updateConstraints(x, y);
            // If still ambiguous, choose randomly from valid candidates.
            let chosen = Phaser.Utils.Array.GetRandom(valid);
            cell.possibilities = [chosen];
            cell.collapsed = true;
            this.layer.putTileAt(this.tileIndices[chosen], x, y);
            this.enqueueNeighbors(x, y);
        }
    }

    // Find the non-collapsed cell with the fewest possibilities (lowest entropy).
    findLowestEntropyCell() {
        let minEntropy = Infinity;
        let candidate = null;
        for (let y = 0; y < this.mapHeight; y++) {
            for (let x = 0; x < this.mapWidth; x++) {
                let cell = this.grid[y][x];
                if (!cell.collapsed) {
                    let entropy = cell.possibilities.length;
                    if (entropy < minEntropy) {
                        minEntropy = entropy;
                        candidate = { x, y };
                    }
                }
            }
        }
        return candidate;
    }


    // Decoration Function: Add decorations based on terrain type.
    addDecorations() {
        // Loop over the grid and add decorations on top of certain tile types.
        for (let y = 0; y < this.mapHeight; y++) {
            for (let x = 0; x < this.mapWidth; x++) {
                let cell = this.grid[y][x];
                if (!cell.collapsed) continue; // Shouldn't happen
                const type = cell.possibilities[0];
                // For demonstration, use a probability so not every tile is decorated.
                if (type === "snow") {
                    // 10% chance to place a snowman on snow
                    if (Math.random() < 0.1) {
                        this.decorationLayer.putTileAt(this.decorationIndices.snowman, x, y);
                    }
                } else if (type === "grass") {
                    // 30% chance to place a tree on grass
                    if (Math.random() < 0.3) {
                        this.decorationLayer.putTileAt(this.decorationIndices.tree, x, y);
                    }
                } else if (type === "sand") {
                    // 10% chance to place a cactus on sand (desert)
                    if (Math.random() < 0.1) {
                        this.decorationLayer.putTileAt(this.decorationIndices.cactus, x, y);
                    }
                }
            }
        }
    }
}

const config = {
    type: Phaser.CANVAS,
    width: 1280,
    height: 960,
    backgroundColor: '#87CEEB',
    scene: [WaveCollapseRealLandscapeScene],
    pixelArt: true
};

const game = new Phaser.Game(config);
