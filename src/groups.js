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

// an object that wraps a jQuery deferred for asynchronous execution
class Deferred {
    #deferred

    constructor() {
        this.ready = false
        this.#deferred = $.Deferred()
    }

    get deferred() {
        return this.#deferred.promise()
    }

    complete() {
        this.ready = true
        this.#deferred.resolve()
    }
}

// a group of items fetched from a service
export class Group extends Deferred {
    #routine
    #selected

    constructor(items, type, name, data = {}) {
        super()

        // if items is a function, this is assigned to the internal fetching routine and the items are empty
        // otherwise, the routine simply calls "complete" and the items are mapped using the utility function
        let routine
        if (typeof items === "function") {
            routine = items
            items = []
        } else {
            routine = group => group.complete()
            items = items.map(it => item(it))
        }

        // the items of the group
        this.items = items

        // the name of the group
        this.name = name

        // the inner data of the group, used to serialize it in JSON format and to restore the object later
        this.data = {type: type, name: name, ...data}

        // the routine to fetch additional data (e.g., single tracks of a playlist)
        this.#routine = routine

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
        this.items.push(...data.map(item))
    }

    static fromJSON({type, items, ...data}) {
        const constructor = types[type]
        if (constructor) {
            return new constructor(items, data)
        } else {
            throw new Error("Unknown type: " + type)
        }
    }
}

export class Artists extends Group {
    constructor(items) {
        super(items, "artists", "Favourite Artists")
    }
}

export class Albums extends Group {
    constructor(items) {
        super(items, "albums", "Favourite Albums")
    }
}

export class Tracks extends Group {
    constructor(items) {
        super(items, "tracks", "Favourite Tracks")
    }
}

export class Playlist extends Group {
    constructor(items, {name, description, open}) {
        super(items, "playlist", name, {description: description, open: open})
    }
}

// a group which represents a set of groups
export class All extends Group {
    constructor(items, routine = group => group.complete()) {
        // pass the routine to the super constructor
        super(routine, "all", undefined)
        // add the already fetched items to itself
        this.add(items)
        // then set "selected" to true to start the additional items fetching routine
        this.selected = true
        // set the initial name
        this.name = `ALL (${this.items.length} ${this.items.length === 1 ? "GROUP" : "GROUPS"})`
    }

    add(groups) {
        this.items.push(...groups)
        this.name = `ALL (${this.items.length} ${this.items.length === 1 ? "GROUP" : "GROUPS"})`
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

        // the items that are not available in the target service
        this.missing = []

        // the amount of transferred items
        this.transferred = 0

        // the transferring status (1: fetching, 2: transferring, 3: completed, or 0: aborted)
        this.#status = 1

        // set a callback for when all the group items have been fetched
        group.deferred.then(() => {
            // filter the internal items to keep the select items only
            this.items = group.items.filter(it => it.selected)
            // set the transferred items to zero to indicate that the transferring can start
            this.#status = 2
        })
    }

    get status() {
        switch (this.#status) {
            case 1:
                return "Fetching (" + this.items.length + " items)"
            case 2:
                return "Transferring (" + this.transferred + " items)"
            case 3:
                return "Completed (" + this.missing.length + " missing)"
            default:
                return "Transferring Process Aborted"
        }
    }

    // increment the value of transferred items (to be called from an outside handler)
    increment(value = 1) {
        this.transferred += value
    }

    // set the status to 3 (completed) when "complete" is called
    complete() {
        super.complete()
        this.#status = 3
    }

    // stops the transferring due to a request error (super call to "complete", but then set the status to 0)
    abort() {
        super.complete()
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