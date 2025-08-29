import {Group, Transfer} from "./groups.js"

export const redirect = "https://localhost:63342/music-transfer/index.html"
const alphanumeric = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

// generates a random alphanumeric string
function generate(length) {
    return crypto
        .getRandomValues(new Uint8Array(length))
        .reduce((output, value) => output + alphanumeric[value % alphanumeric.length], "")
}

// an object with the same structure of a group which represents a set of groups
function all(groups) {
    return {
        items: groups,
        ready: true,
        title: `ALL (${groups.length} ${groups.length === 1 ? "GROUP" : "GROUPS"})`
    }
}

export class Service {
    authorizationEndpoint = undefined
    exchangeEndpoint = undefined
    clientID = undefined
    scope = undefined
    #fetched

    // pass angular update routine ($scope.$apply) to update the scope on ajax responses
    constructor(update, name, token) {
        this.id = this.constructor.name
        this.name = name
        this.token = token ? token : this.#get("token")
        this.verifier = this.#get("verifier")
        this.state = this.#get("state")
        this.groups = []
        this.update = update
        this.#fetched = false
    }

    #get(key) {
        return sessionStorage.getItem(key + this.name)
    }

    #set(key, value) {
        sessionStorage.setItem(key + this.name, value)
        this[key] = value
    }

    #remove(key) {
        sessionStorage.removeItem(key + this.name)
        this[key] = undefined
    }

    clear() {
        this.#remove("state")
        this.#remove("verifier")
        this.#remove("token")
    }

    login({code, done = () => void 0, fail = () => void 0}) {
        // if the token is already available, return without any additional operation
        if (this.token) return
        // if the code is undefined, try to authenticate to the service
        // otherwise, use the code to send a post request and get the access token in exchange
        if (code === undefined) {
            // build and store random state and code verifier for the payload (saved in the storage)
            const verifier = generate(64)
            const state = generate(16)
            this.#set("verifier", verifier)
            this.#set("state", state)
            // perform cryptographic operations to get the code challenge from the verifier
            crypto.subtle
                // hash the built verifier using SHA-256
                .digest('SHA-256', new TextEncoder().encode(verifier))
                // reconvert it to an array and then to a string
                .then(hashed => new Uint8Array(hashed))
                .then(hashed => String.fromCharCode(...hashed))
                // manipulate the hash to obtain the challenge code
                .then(hashed => btoa(hashed)
                    .replace(/=/g, '')
                    .replace(/\+/g, '-')
                    .replace(/\//g, '_'))
                // run the done() routine and redirect to authorization link
                .then(challenge => {
                    const url = new URL(this.authorizationEndpoint)
                    url.search = new URLSearchParams({
                        response_type: "code",
                        redirect_uri: redirect,
                        client_id: this.clientID,
                        scope: this.scope,
                        code_challenge_method: "S256",
                        code_challenge: challenge,
                        state: state
                    }).toString()
                    done(url)
                    location = url
                })
        } else {
            $.ajax({
                url: this.exchangeEndpoint,
                method: "POST",
                data: {
                    grant_type: "authorization_code",
                    client_id: this.clientID,
                    redirect_uri: redirect,
                    code_verifier: this.verifier,
                    code: code
                }
            }).then(res => {
                this.clear()
                this.#set("token", res.access_token)
            }).done(done).fail(fail).always(() => this.update())
        }
    }

    fetch({done = () => void 0, fail = () => void 0}) {
        // if items have been already fetched, call the done() routine
        // otherwise run the protected fetch routine and assign the results
        if (this.#fetched) {
            done()
        } else {
            this.#fetched = true
            this.fetchRoutine().then(res => {
                this.groups = [all(res), ...res]
            }).done(done).fail(fail).always(() => this.update())
        }
    }

    transfer(group) {
        // if the group is a Group instance return itself wrapped in an array, otherwise handle the "all" wrapper
        const groups = group instanceof Group ? [group] : group.items.filter(it => it.selected)
        return groups.map(group => new Transfer(group, this.transferRoutine))
    }

    fetchRoutine() {
    }

    transferRoutine(transferring) {
    }
}

