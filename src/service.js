import {All, Transfer} from "./groups.js"

const redirect = location.origin + location.pathname
const alphanumeric = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

// generates a random alphanumeric string
function generate(length) {
    return crypto
        .getRandomValues(new Uint8Array(length))
        .reduce((output, value) => output + alphanumeric[value % alphanumeric.length], "")
}

class Service {
    #role
    #token
    #selected
    #check
    #credentials

    constructor({name, title, token, check, role}) {
        // the service role (either source or target)
        this.#role = role

        // whether the service is currently selected
        this.#selected = sessionStorage.getItem(role) === name

        // the inner routine to perform safety checks
        // check: ({done, fail, apply}) => void
        this.#check = check

        // if the token is an object, the function to get the token consists in loading it from the session storage
        this.#token = typeof token === "object" ? () => sessionStorage.getItem("token" + this.name) : token

        // if the token is an object, it contains the credentials, otherwise no authorization is needed for the service
        this.#credentials = typeof token === "object" ? token : undefined

        // the (short) name of the service
        this.name = name

        // the (long) title of the service, if undefined the name is chosen instead
        this.title = title || name
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

    check({done = () => void 0, fail = () => void 0, apply = () => void 0}) {
        this.#check({done: done, fail: fail, apply: apply})
    }

    // clears the cache of the service
    clear() {
        sessionStorage.removeItem("token" + this.name)
        sessionStorage.removeItem("state" + this.name)
        sessionStorage.removeItem("verifier" + this.name)
    }

    // tries to log into the service in order to get the access token
    login({done = () => void 0, fail = _ => void 0, apply = () => void 0}) {
        // if authentication is not needed (i.e., no credentials are available) stop the routine
        if (!this.#credentials) {
            done()
            return
        }
        // otherwise, build and store random state and code verifier for the payload (saved in the storage)
        const state = generate(16)
        const verifier = generate(64)
        sessionStorage.setItem("state" + this.name, state)
        sessionStorage.setItem("verifier" + this.name, verifier)
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
                sessionStorage.setItem("waiting", this.name)
                const url = new URL(this.#credentials.authorizationEndpoint)
                url.search = new URLSearchParams({
                    response_type: "code",
                    redirect_uri: redirect,
                    client_id: this.#credentials.clientID,
                    scope: this.#credentials.scope,
                    code_challenge_method: "S256",
                    code_challenge: challenge,
                    state: state
                }).toString()
                location = url
            })
            .catch(fail)
            .finally(apply)
    }

    exchange({code, state, done = () => void 0, fail = () => void 0, apply = () => void 0}) {
        // if authentication is not needed (i.e., no credentials are available) stop the routine
        if (!this.#credentials) {
            done()
            return
        }
        const expectedState = sessionStorage.getItem("state" + this.name)
        const verifier = sessionStorage.getItem("verifier" + this.name)
        // if the yielded state is correct, perform the post request using the returned code
        // otherwise, run the failure routine (no need to call apply to update the scope)
        this.clear()
        if (state === expectedState) {
            $.ajax({
                url: this.#credentials.exchangeEndpoint,
                method: "POST",
                data: {
                    grant_type: "authorization_code",
                    client_id: this.#credentials.clientID,
                    redirect_uri: redirect,
                    code_verifier: verifier,
                    code: code
                }
                // if everything goes well, clear the cache and store the obtained token
            }).then(res => sessionStorage.setItem("token" + this.name, res.access_token))
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
}

export class SourceService extends Service {
    #all
    #fetch

    constructor({name, title, token, check, fetch}) {
        super({name: name, title: title, token: token, check: check, role: "source"})

        // whether the service has correctly fetched the results
        this.fetched = false

        // an "All" object containing all the groups (already fetched or to be fetched)
        this.#all = undefined

        // the inner fetching routine taking the callback routines as input
        // fetch: ({done, fail, apply}) => void
        this.#fetch = fetch
    }

    get groups() {
        return this.#all ? [this.#all, ...this.#all.items] : []
    }

    fetchRecursive({url, routine, request, apply, attempt = 0}) {
        return group => {
            // always start the routine after an exponentially higher time (to be increased after failures)
            new Promise(handler => setTimeout(handler, 10 ** attempt)).then(() => {
                // if the url is undefined, the fetching process is done
                if (!url) {
                    group.done()
                    apply()
                    return
                }
                // otherwise, send a request to the url:
                //   - retrieve the new url from the routine and add the new items to the group
                //   - in case of success, reset the attempt, otherwise increment it
                //   - eventually, run the recursive fetch routine and apply changes
                request(url, this.token)
                    .then(res => {
                        const output = routine(res)
                        output.items.forEach(it => group.add(it))
                        return output.url
                    })
                    .done(newUrl => {
                        url = newUrl
                        attempt = 0
                    })
                    .fail(res => {
                        console.warn("Error during recursive fetching", res)
                        attempt = attempt + 1
                    })
                    .always(_ => {
                        this.fetchRecursive({
                            url: url,
                            routine: routine,
                            request: request,
                            apply: apply,
                            attempt: attempt + 1
                        })(group)
                        apply()
                    })
            })
        }
    }

    fetch({done = _ => void 0, fail = _ => void 0, apply = _ => void 0}) {
        // if the service was already fetched, call the "done" routine (no need to apply)
        if (this.fetched) {
            done()
            return
        }
        // otherwise, set the fetched status to true to avoid multiple calls and call the routine
        this.fetched = true
        this.#fetch({
            done: res => {
                // if the routine succeed, assign the groups
                this.#all = res
                done(res)
            },
            fail: res => {
                // if it fails, restore the fetched status to false
                this.fetched = false
                fail(res)
            },
            apply: apply
        })
    }
}

export class TargetService extends Service {
    #transfer
    #finished

    constructor({name, title, token, check, transfer}) {
        super({name: name, title: title, token: token, check: check, role: "target"})

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

    transferRecursive({requests, transfer, apply, attempt = 0}) {
        // always start the routine after an exponentially higher time (to be increased after failures)
        new Promise(handler => setTimeout(handler, 10 ** attempt)).then(() => {
            // if the transferred items are equal to the total number, stop the routine since the transferring is done
            if (transfer.transferred === transfer.items.length) {
                transfer.done()
                apply()
                return
            }
            // otherwise, send a request to the url
            requests(
                this.token,
                increment => {
                    transfer.increment(increment)
                    this.transferRecursive({
                        requests: requests,
                        transfer: transfer,
                        apply: apply,
                        attempt: attempt,
                    })
                    apply()
                },
                res => {
                    console.warn("Error during recursive transfer", res)
                    this.transferRecursive({
                        requests: requests,
                        transfer: transfer,
                        apply: apply,
                        attempt: attempt + 1,
                    })
                }
            ).fail(res => {
                console.warn("Error during recursive getting in transfer", res)
                this.transferRecursive({
                    requests: requests,
                    transfer: transfer,
                    apply: apply,
                    attempt: attempt,
                })
            })
        })
    }

    transfer({group, apply = _ => void 0}) {
        // if the input is an "All" instance get the selected items, otherwise build a list out of the single group
        const groups = group instanceof All ? group.items.filter(it => it.selected) : [group]
        // build a new transfer object for each single group and start the transfer when the group is ready
        this.transfers = groups.map(group => new Transfer(group))
        // additionally keep track of how many items have been completely transferred using the onReady routine
        // and when the number of transferred items is equal to the number of total items, set the flag to true
        // (use the for loop for guaranteed sequentiality, and set the transfer callback before the group callback
        //  to avoid issues with parallelism when all the groups have already been fetched)
        let transferred = 0
        this.#finished = transferred === groups.length
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