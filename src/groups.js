// maps the data of an item (i.e., track, album, artist) into a standardized object with additional metadata
function item(data) {
    const name = data.name
    const artist = data.artists?.at(0)
    return {
        name: name + (artist ? " (" + artist + ")" : ""),
        selected: true,
        data: data
    }
}

// an object whose execution can be deferred
class Deferred {
    #ready
    #callbacks

    constructor() {
        // internal variable to keep track of whether all the execution is finished
        this.#ready = false

        // additional callbacks to be called once the execution is finished
        this.#callbacks = []
    }

    get ready() {
        return this.#ready
    }

    onReady(callback) {
        // push the callback in the list
        this.#callbacks.push(callback)
        // if the object is ready (i.e., the execution is finished), run the callback and clear the list
        if (this.ready) {
            callback()
        }
    }

    done() {
        // changes the ready state and runs the callbacks after (to be called from an outside handler)
        this.#ready = true
        for (const callback of this.#callbacks) {
            callback()
        }
    }
}

// a group of items fetched from a service
export class Group extends Deferred {
    #routine
    #selected

    constructor({type, name, length, items, routine, ...data}) {
        super()

        // the items of the group (mapped using the utility function) or an empty list if undefined
        this.items = items ? items.map(it => item(it)) : []

        // the (expected) length of the group, or the (actual) length of its items if undefined
        this.length = length || this.items.length

        // the (short) name of the group
        this.name = name

        // the (long) title of the group
        this.title = `${name} (${this.length} ${this.length === 1 ? "item" : "items"})`

        // the inner data of the group, used to serialize it in JSON format and to restore the object later
        this.data = {type: type, name: name, ...data}

        // the (optional) routine to fetch additional data (e.g., single tracks of a playlist)
        this.#routine = routine ? routine : self => self.done()

        // whether the group was chosen for transferring to the source target
        this.#selected = false
    }

    get selected() {
        return this.#selected
    }

    set selected(value) {
        this.#selected = value
        // when selected, run the routine and "consume" it by restoring an empty value after it gets called
        if (value) {
            this.#routine(this)
            this.#routine = () => void 0
        }
    }

    // push an additional item to the internal group items (to be called from an outside handler)
    add(data) {
        this.items.push(item(data))
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

    // override the "add" method with class-specific parameters
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

    // override the "add" method with class-specific parameters
    add({name, artists, barcode}) {
        super.add({name: name, artists: artists, barcode: barcode})
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

    // override the "add" method with class-specific parameters
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

    // override the "add" method with class-specific parameters
    add({name, artists, isrc}) {
        super.add({name: name, artists: artists, isrc: isrc})
    }
}

// a group wrapper that includes transferring information
export class Transfer extends Deferred {
    #status

    constructor(group) {
        super()

        // the group data to be used for json dumping
        this.data = group.data

        // set the name as the wrapped group one
        this.name = group.name

        // set the items as the group ones to keep track of their fetching
        this.items = group.items

        // initially set the (expected) length as the group one
        this.length = group.length

        // the amount of transferred items
        this.transferred = 0

        // the transferring status (1: fetching, 2: transferring, 3: completed, or 0: aborted)
        this.#status = 1

        // set a callback for when all the group items have been fetched
        group.onReady(() => {
            // filter the internal items to keep the select items only
            this.items = group.items.filter(it => it.selected)
            // update the length accordingly
            this.length = this.items.length
            // set the transferred items to zero to indicate that the transferring can start
            this.#status = 2
        })
    }

    get status() {
        switch (this.#status) {
            case 3:
                return "Transfer Completed!"
            case 2:
                return "Transferring " + this.transferred + "/" + this.length
            case 1:
                return "Fetching " + this.items.length + "/" + this.length
            case 0:
                return "Transferring Process Aborted"
        }
    }

    // increment the value of transferred items (to be called from an outside handler)
    increment(value = 1) {
        this.transferred += value
    }

    // set the status to 3 (completed) when "done" is called
    done() {
        super.done()
        this.#status = 3
    }

    // stops the transferring due to a request error (super call to "done", but then set the status to 0)
    abort() {
        super.done()
        this.#status = 0
    }

    toJSON() {
        return {...this.data, items: this.items.map(it => it.data)}
    }
}

const types = {
    "artists": Artists,
    "albums": Albums,
    "tracks": Tracks,
    "playlist": Playlist
}