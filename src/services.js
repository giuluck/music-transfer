const alphanumeric = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
const country = navigator.language.split('-')[1]
const locale = navigator.language

function generate(length) {
    return crypto
        .getRandomValues(new Uint8Array(length))
        .reduce((output, value) => output + alphanumeric[value % alphanumeric.length], "")
}


class Service {
    client_id = null
    authorization_endpoint = null
    exchange_endpoint = null
    scope = null

    constructor() {
        if (this.constructor === Service) {
            throw new Error("Cannot instantiate an abstract class")
        }
        this.name = this.constructor.name
    }

    _set(key, value) {
        localStorage.setItem(key + this.name, value)
    }

    _get(key) {
        return localStorage.getItem(key + this.name)
    }

    _remove(key) {
        return localStorage.removeItem(key + this.name)
    }

    verifier() {
        return this._get("verifier")
    }

    state() {
        return this._get("state")
    }

    token() {
        return this._get("token")
    }

    authorization_url() {
        // build and store random state and code verifier for the payload (saved in the storage)
        const verifier = generate(64)
        const state = generate(16)
        this._set("verifier", verifier)
        this._set("state", state)
        // perform cryptographic operations to get the code challenge from the verifier
        return crypto.subtle
            // hash the built verifier using SHA-256
            .digest('SHA-256', new TextEncoder().encode(verifier))
            // reconvert it to an array and then to a string
            .then(hashed => new Uint8Array(hashed))
            .then(hashed => String.fromCharCode(...hashed))
            // manipulate the hash to obtain the challenge code
            .then(hashed => btoa(hashed)
                .replace(/=/g, '')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
            )
            // return the authorization link as the base url plus the additional parameters concatenated
            .then(challenge => {
                const url = new URL(this.authorization_endpoint)
                url.search = new URLSearchParams({
                    response_type: "code",
                    redirect_uri: entrypoint,
                    client_id: this.client_id,
                    scope: this.scope,
                    code_challenge_method: "S256",
                    code_challenge: challenge,
                    state: state
                }).toString()
                return url.toString()
            })
    }

    exchange_token(code) {
        return $.ajax({
            url: this.exchange_endpoint,
            method: "POST",
            data: {
                grant_type: "authorization_code",
                client_id: this.client_id,
                redirect_uri: entrypoint,
                code_verifier: this.verifier(),
                code: code
            }
        }).then(res => {
            // store the received token
            this._set("token", res.access_token)
            // remove the codes
            this._remove("verifier")
            this._remove("state")
        })
    }

    export() {
    }

    import(data) {
    }
}

class Spotify extends Service {
    client_id = "d45c460b9f56492ea9c297993d7efdb7"
    authorization_endpoint = "https://accounts.spotify.com/authorize"
    exchange_endpoint = "https://accounts.spotify.com/api/token"
    scope = "playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-library-read user-library-modify"
}

class Tidal extends Service {
    client_id = "CE49NT7wvkwoZ1s3"
    authorization_endpoint = "https://login.tidal.com/authorize"
    exchange_endpoint = "https://auth.tidal.com/v1/oauth2/token"
    scope = "collection.read collection.write playlists.read playlists.write"

    response(url, {
        method = "GET",
        accept = "application/vnd.api+json",
        content_type = "application/x-www-form-urlencoded; charset=UTF-8",
        ...data
    } = {}) {
        return $.ajax({
            url: `https://openapi.tidal.com/v2/${url}`,
            method: method,
            contentType: content_type,
            headers: {accept: accept, Authorization: "Bearer " + this.token()},
            data: data
        })
    }

    export() {
        // fetch user information to get its identifier
        return this.response("users/me")
            .then(res => res.data.id)
            .then(id => this.response(
                "userCollections/" + id +
                "?locale=" + locale +
                "&countryCode=" + country +
                "&include=playlists" +
                "&include=albums" +
                "&include=artists"
            ))
            .then(res => res.included)
            .then(items => {
                const groups = Object.groupBy(items, item => item.type)
                return groups.playlists
            })
            .then(console.log)


        // .then(res => {
        //     return playlists.map(playlist => this.response(
        //         `playlists?countryCode=${constants.country}&filter%5Br.owners.id%5D=${id}`,
        //     )).then(attributes => new Object({
        //         name: attributes.name,
        //         description: attributes.description,
        //         public: attributes.accessType === "PUBLIC",
        //     }))
        // })
    }

    import(data) {
        for (let i = 0; i < playlists.length; i++) {
            // iterate over all the playlists
            const playlist = playlists[i]
            // map each track to their respective id
            const tracks = playlist.tracks.map(track => this
                .response(`tracks?countryCode=${constants.country}&filter%5Bisrc%5D=${track.isrc}`)
                .then(res => Object({id: res.data[0].id, type: "tracks"}))
            )
            // build the playlist with the obtained items
            const playlist_id = this.response(
                `playlists?countryCode=${constants.country}`,
                {
                    headers: {"Content-Type": "application/vnd.api+json"},
                    method: "POST",
                    data: {
                        type: "playlists",
                        attributes: {
                            name: playlist.name,
                            description: playlist.description,
                            accessType: playlist.public ? "PUBLIC" : "PRIVATE"
                        }
                    }
                }
            ).then(res => res.data.id)
            // use the retrieved playlist id to add all the tracks
            this.response(
                `playlists/${playlist_id}/relationships/items?countryCode=${constants.country}`,
                {
                    method: "POST",
                    headers: {accept: "*/*", "Content-Type": "application/vnd.api+json"},
                    data: tracks
                }
            )
        }
    }
}

// dummy service to handle selections
class Null extends Service {
    constructor() {
        super()
        this.disabled = true
        this.name = "Select an option..."
    }

    _set(key, value) {
    }
}

export const entrypoint = "https://localhost:63342/music-transfer/index.html"
export const services = {
    null: new Null(),
    Spotify: new Spotify(),
    Tidal: new Tidal()
}