export class Group {
    #routine
    #ready
    #selected
    #callbacks

    constructor({type, name, length, items, routine, ...data}) {
        this.name = name
        this.items = items ? items.map(it => item(it)) : []
        this.length = length ? length : this.items.length
        this.title = `${name} (${this.length} ${this.length === 1 ? "item" : "items"})`
        this.data = {type: type, name: name, ...data}
        this.#routine = routine ? routine : self => self.done()
        this.#ready = false
        this.#selected = false
        this.#callbacks = []
    }

    get ready() {
        return this.#ready
    }

    get selected() {
        return this.#selected
    }

    set selected(value) {
        this.#selected = value
        // when selected, run the routine and consume it by restoring an empty value after it gets called
        if (value) {
            this.#routine(this)
            this.#routine = () => void 0
        }
    }

    onReady(callback) {
        if (this.ready) {
            callback()
            this.#callbacks = []
        } else {
            this.#callbacks.push(callback)
        }
    }

    add(data) {
        this.items.push(item(data))
    }

    done() {
        this.#ready = true
        this.#callbacks.forEach(callback => callback())
    }

    toJSON() {
        return {...this.data, items: this.items.map(it => it.data)}
    }

    static fromJSON({type, items, ...data}) {
        const constructor = types[type]
        if (constructor) {
            return new constructor({items: items, ...data})
        } else {
            throw new Error("Unknown type: " + type)
        }
    }
}

export class Artists extends Group {
    constructor({length, items, routine}) {
        super({
            type: "artists",
            name: "Favourite Artists",
            items: items,
            length: length,
            routine: routine
        })
    }

    add({name}) {
        super.add({name: name})
    }
}

export class Albums extends Group {
    constructor({length, items, routine}) {
        super({
            type: "albums",
            name: "Favourite Albums",
            items: items,
            length: length,
            routine: routine
        })
    }

    add({name, artists}) {
        super.add({name: name, artists: artists})
    }
}

export class Tracks extends Group {
    constructor({length, items, routine}) {
        super({
            type: "tracks",
            name: "Favourite Tracks",
            length: length,
            items: items,
            routine: routine
        })
    }

    add({name, artists, isrc}) {
        super.add({name: name, artists: artists, isrc: isrc})
    }
}

export class Playlist extends Group {
    constructor({name, length, description, open, items, routine}) {
        super({
            type: "playlist",
            name: name,
            length: length,
            description: description,
            open: open,
            items: items,
            routine: routine
        })
    }

    add({name, artists, isrc}) {
        super.add({name: name, artists: artists, isrc: isrc})
    }
}

// a group wrapper that includes transferring information
export class Transfer extends Group {
    constructor(group, routine) {
        super({routine: routine, ...group.data})
        this.transferred = undefined
        // assign items from here rather than the constructor to avoid the call to the item() function
        this.items = group.items
        this.length = group.length
        // when the group items have been fetched
        group.onReady(() => {
            // set the internal items as the selected items only
            this.items = group.items.filter(it => it.selected)
            this.length = this.items.length
            // set the transferred items to zero
            this.transferred = 0
            // assign selected to true in order to run the internal routine
            this.selected = true
        })
    }

    increment(value = 1) {
        this.transferred += value
    }
}

function item(data) {
    const name = data.name
    const artist = data.artists?.at(0)
    return {
        name: name + (artist ? ` (${artist})` : ""),
        selected: true,
        data: data
    }
}

const types = {
    "artists": Artists,
    "albums": Albums,
    "tracks": Tracks,
    "playlist": Playlist
}