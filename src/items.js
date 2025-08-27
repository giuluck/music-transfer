export class Item {
    constructor(name) {
        this.name = name
        this.selected = true
    }

    toString() {
        return this.name
    }

    toJson() {
        return {name: this.name}
    }
}

export class Artist extends Item {
    constructor({name}) {
        super(name)
    }
}

export class Album extends Item {
    constructor({name, artists}) {
        super(name)
        this.artists = artists
    }

    toString() {
        return this.name + (this.artists ? ` (${this.artists[0]})` : "")
    }

    toJson() {
        return {name: this.name, artists: this.artists}
    }
}

export class Track extends Item {
    constructor({name, artists, isrc}) {
        super(name)
        this.artists = artists
        this.isrc = isrc
    }

    toString() {
        return this.name + (this.artists ? ` (${this.artists[0]})` : "")
    }

    toJson() {
        return {name: this.name, artists: this.artists, isrc: this.isrc}
    }
}

export class Group extends Item {
    constructor({name, kind, items, fetch = _ => undefined}) {
        super(name)
        this.kind = kind
        this.size = items.length
        this.items = items
        this._fetch = fetch
        this._fetched = false
    }

    add(item) {
        this.items.push(item)
    }

    fetch() {
        if (!this._fetched) {
            this._fetch(this)
            this._fetched = true
        }
    }

    ready() {
        return this.size === this.items.length
    }

    toString() {
        return this.name + " (" + this.size + " items)"
    }

    toJson() {
        return {
            kind: this.kind,
            name: this.name,
            items: this.items.filter(item => item.selected).map(item => item.toJson())
        }
    }
}

export class Playlist extends Group {
    constructor({name, kind = "playlist", description, open, size, items = [], fetch = _ => undefined}) {
        super({name: name, kind: kind, items: items, fetch: fetch})
        this.description = description
        this.open = open
        this.size = size
    }

    toJson() {
        return {
            kind: this.kind,
            name: this.name,
            description: this.description,
            open: this.open,
            size: this.size,
            items: this.items.filter(item => item.selected).map(item => item.toJson())
        }
    }
}