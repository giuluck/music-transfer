import {Group, Transfer} from "./groups.js"

const redirect = "https://localhost:63342/music-transfer/index.html"
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

function authLogin({service, login, clientID, authorizationEndpoint, scope, done, fail, apply}) {
    // execute the custom routine
    login()
    // build and store random state and code verifier for the payload (saved in the storage)
    const state = generate(16)
    const verifier = generate(64)
    sessionStorage.setItem("state" + service.name, state)
    sessionStorage.setItem("verifier" + service.name, verifier)
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
        // run the done() routine, set the waiting flag to this service, then redirect to the authorization link
        .then(challenge => {
            done()
            sessionStorage.setItem("waiting", service.name)
            const url = new URL(authorizationEndpoint)
            url.search = new URLSearchParams({
                response_type: "code",
                redirect_uri: redirect,
                client_id: clientID,
                scope: scope,
                code_challenge_method: "S256",
                code_challenge: challenge,
                state: state
            }).toString()
            location = url
        })
        .catch(fail)
        .finally(apply)
}

function authExchange({service, code, state, clientID, exchangeEndpoint, done, fail, apply}) {
    const expectedState = sessionStorage.getItem("state" + service.name)
    const verifier = sessionStorage.getItem("verifier" + service.name)
    // if the yielded state is correct, perform the post request using the returned code
    // otherwise, run the failure routine (no need to call apply to update the scope)
    service.clear()
    if (state === expectedState) {
        $.ajax({
            url: exchangeEndpoint,
            method: "POST",
            data: {
                grant_type: "authorization_code",
                client_id: clientID,
                redirect_uri: redirect,
                code_verifier: verifier,
                code: code
            }
            // if everything goes well, clear the cache and store the obtained token
        }).then(res => sessionStorage.setItem("token" + service.name, res.access_token))
            .done(done)
            .fail(fail)
            .always(() => {
                sessionStorage.removeItem("waiting")
                apply()
            })
    } else {
        sessionStorage.removeItem("waiting")
        fail({expected: expectedState, obtained: state})
    }
}

function authClear({service, clear}) {
    // execute the custom routine, then remove the cached items
    clear()
    sessionStorage.removeItem("token" + service.name)
    sessionStorage.removeItem("state" + service.name)
    sessionStorage.removeItem("verifier" + service.name)
}

class Service {
    #role
    #token
    #selected
    #login
    #clear

    constructor({name, title, token, role, login = () => void 0, clear = () => void 0}) {
        // the service role (either source or target)
        this.#role = role

        // whether the service is currently selected
        this.#selected = sessionStorage.getItem(role) === name

        // the (short) name of the service
        this.name = name

        // the (long) title of the service, if undefined the name is chosen instead
        this.title = title || name

        // if the token is an object, implement the login and clear functions to support authorization strategies
        // (this is needed since javascript does not support neither interfaces nor multiple inheritance)
        if (typeof token === "object" && token !== null) {
            // if for authorization, the token must have this structure
            const {clientID, authorizationEndpoint, exchangeEndpoint, scope} = token
            // set the token and the additional information needed
            this.#token = () => sessionStorage.getItem("token" + this.name)
            // assign the clear and login functions
            this.#clear = () => authClear({service: this, clear: clear})
            this.#login = ({done = () => void 0, fail = () => void 0, apply = () => void 0}) =>
                authLogin({
                    service: this,
                    login: login,
                    clientID: clientID,
                    authorizationEndpoint: authorizationEndpoint,
                    scope: scope,
                    done: done,
                    fail: fail,
                    apply: apply
                })
            this.exchange = ({code, state, done = () => void 0, fail = () => void 0, apply = () => void 0}) =>
                authExchange({
                    service: this,
                    code: code,
                    state: state,
                    clientID: clientID,
                    exchangeEndpoint: exchangeEndpoint,
                    done: done,
                    fail: fail,
                    apply: apply
                })
        } else {
            // otherwise, set custom values (token must be a function)
            this.#token = token
            this.#login = login
            this.#clear = clear
        }
    }

    get token() {
        return this.#token()
    }

    get logged() {
        return Boolean(this.token)
    }

    get waiting() {
        return sessionStorage.getItem("waiting") === this.name
    }

    get selected() {
        return this.#selected
    }

    select() {
        this.#selected = true
        sessionStorage.setItem(this.#role, this.name)
    }

    deselect() {
        this.#selected = false
        sessionStorage.removeItem(this.#role)
    }

    // clears the cache of the service
    clear() {
        this.#clear()
    }

    // tries to log into the service in order to get the access token
    login({done = () => void 0, fail = _ => void 0, apply = () => void 0}) {
        this.#login({done: done, fail: fail, apply: apply})
    }
}

export class SourceService extends Service {
    #fetch
    #fetched

    constructor({name, title, token, fetch}) {
        super({name: name, title: title, token: token, role: "source"})

        // a list of Group instances fetched from the service
        this.groups = []

        // the inner fetching routine taking the callback routines as input
        // fetch: ({done, fail, apply}) => void
        this.#fetch = fetch

        // whether the service has correctly fetched the results
        this.#fetched = false
    }

    fetch({done = _ => void 0, fail = _ => void 0, apply = _ => void 0}) {
        // if the service was already fetched, call the "done" routine (no need to apply)
        if (this.#fetched) {
            done()
        }
        // otherwise, set the fetched status to true to avoid multiple calls and call the routine
        this.#fetched = true
        this.#fetch({
            done: res => {
                // if the routine succeed, assign the groups
                this.groups = [all(res), ...res]
                done(res)
            },
            fail: res => {
                // if it fails, restore the fetched status to false
                this.#fetched = false
                fail(res)
            },
            apply: apply
        })
    }
}

export class TargetService extends Service {
    #transfer
    #finished

    constructor({name, title, token, transfer}) {
        super({name: name, title: title, token: token, role: "target"})

        // a list of Transfer instances transferred from the source service (initially empty)
        this.transfers = []

        // the inner transfer routine taking the current Transfer instance and the updating function
        // transfer: ({instance, apply}) => void
        this.#transfer = transfer

        // flag to keep track of when every transfer object has been transferred
        this.#finished = false
    }

    get finished() {
        return this.#finished
    }

    transfer({group, apply = _ => void 0}) {
        // if the input is a Group instance build a list out of it, otherwise handle the "all" object
        const groups = group instanceof Group ? [group] : group.items.filter(it => it.selected)
        // build a new transfer object for each single group and start the transfer when the group is ready
        this.transfers = groups.map(group => new Transfer(group))
        // additionally keep track of how many items have been completely transferred using the onReady routine
        // and when the number of transferred items is equal to the number of total items, set the flag to true
        // (use the for loop for guaranteed sequentiality, and set the transfer callback before the group callback
        //  to avoid issues with parallelism when all the groups have already been fetched)
        let transferred = 0
        for (let i = 0; i < groups.length; i++) {
            this.transfers[i].onReady(_ => {
                transferred++
                this.#finished = transferred === groups.length
            })
            groups[i].onReady(_ => this.#transfer({transfer: this.transfers[i], apply: apply}))
        }
    }
}

export const sourceDummy = new SourceService({
    name: "Dummy",
    title: "Select an option...",
    token: () => false
})

export const targetDummy = new TargetService({
    name: "Dummy",
    title: "Select an option...",
    token: () => false
})