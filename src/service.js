import {All, Transfer} from "./groups.js"

const redirect = location.origin + location.pathname
const alphanumeric = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

// generates a random alphanumeric string
function generate(length) {
    return crypto
        .getRandomValues(new Uint8Array(length))
        .reduce((output, value) => output + alphanumeric[value % alphanumeric.length], "")
}

// handles failure in recursive routines
function failure({res, attempt, message, retry, abort}) {
    // if the res status is "too many requests", 2 seconds times attempt number before retrying
    // otherwise log a warning with the given message and run the "abort" routine
    if (res.status === 429) {
        console.warn("Error during recursive routine, retrying in 2 seconds", res)
        setTimeout(retry, 2000 * attempt)
    } else {
        console.warn(message, res)
        abort()
    }
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
        this.#token = typeof token === "object" ? () => sessionStorage.getItem(this.name + "Token") : token

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
        sessionStorage.removeItem(this.name + "Token")
        sessionStorage.removeItem(this.name + "State")
        sessionStorage.removeItem(this.name + "Verifier")
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
        sessionStorage.setItem(this.name + "State", state)
        sessionStorage.setItem(this.name + "Verifier", verifier)
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
        const expectedState = sessionStorage.getItem(this.name + "State")
        const verifier = sessionStorage.getItem(this.name + "Verifier")
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
            }).then(res => sessionStorage.setItem(this.name + "Token", res.access_token))
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

    fetchRoutine({url, routine, request, apply}) {
        // create a function to recursively fetch items until a new link is given 
        const fetchRecursive = (link, group, attempt = 0) => {
            // if the link is undefined, the fetching process is done, otherwise send a request to the url
            if (!link) {
                group.done()
                apply()
            } else {
                // in case of success, retrieve the new url from the routine and add the new items to the group
                // otherwise, in case of full failure (abort), stop the fetching
                request(link, this.token).done(res => {
                    const output = routine(res)
                    fetchRecursive(output.url, group)
                    group.add(output.items)
                    apply()
                }).fail(res => failure({
                    res: {link: link, ...res},
                    attempt: attempt + 1,
                    message: "Error during recursive fetch",
                    retry: () => fetchRecursive(link, group, attempt + 1),
                    abort: () => {
                        group.done()
                        apply()
                    }
                }))
            }
        }
        // return the fetch routine as a call to the recursive function given a group
        return group => fetchRecursive(url, group)
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

    transferRoutine({query, push, limit, transfer, apply}) {
        let items = transfer.items.map(it => it.data)
        // build a recursive push routine which pushes the queried data in batches of "limit" size
        const pushRecursive = (index = 0, attempt = 0) => {
            const batch = items.slice(index, index + limit)
            if (batch.length === 0) {
                // if the sliced data is empty, the transferring is done
                transfer.done()
            } else {
                // otherwise, try to push the batch and call the recursive function with updated index
                push(batch)
                    .done(_ => {
                        transfer.increment(batch.length)
                        pushRecursive(index + batch.length)
                    })
                    .fail(res => failure({
                        res: {data: batch, ...res},
                        attempt: attempt + 1,
                        message: "Error during recursive push",
                        retry: () => pushRecursive(index, attempt + 1),
                        abort: () => {
                            // in case of full failure also add the batch to the missing list
                            transfer.missing.push(...batch)
                            transfer.increment(batch.length)
                            pushRecursive(index + batch.length)
                        },
                    }))
                    .always(apply)
            }
        }
        // build a recursive query routine that queries a single item
        // (this is due to the fact that services provide filtering options to search for one item at the time)
        const queryRecursive = (index = 0, attempt = 0) => {
            const item = items[index]
            if (item[this.name] !== undefined) {
                // if the data relative to this service is already available, increment the number of transferred items
                transfer.increment(1)
                // unless the service was already available from before (attempt = 0), wait 0.5 seconds (attempt = 1)
                setTimeout(() => queryRecursive(index + 1), 500 * attempt)
                // when all the items have been transferred, keep only those that have service data (non-missing)
                // then reset the number of transferred items and start to push them into the service
                if (transfer.items.length === transfer.transferred) {
                    items = items.filter(it => it[this.name] !== null)
                    transfer.increment(-items.length)
                    pushRecursive()
                }
            } else {
                // otherwise, query the item and store the first result in the service data (or null if no results)
                query(item)
                    .done(res => {
                        // if the result is empty, set the service data to null and add the item to the missing list
                        // otherwise, assign the service data as the first result
                        if (res.length === 0) {
                            item[this.name] = null
                            transfer.missing.push(item)
                        } else {
                            item[this.name] = res[0]
                        }
                        // call the recursive routine on the index itself to get into the base case with service data
                        // set "attempt" to 1 to force waiting some time before the next call
                        queryRecursive(index, 1)
                    })
                    .fail(res => failure({
                        res: {item: item, ...res},
                        attempt: attempt + 1,
                        message: "Error during recursive query",
                        retry: () => queryRecursive(index, attempt + 1),
                        abort: () => {
                            // in case of full failure also set the service data to null and add it to the missing list
                            item[this.name] = null
                            transfer.missing.push(item)
                            queryRecursive(index, 1)
                        }
                    }))
                    .always(apply)
            }
        }
        // start the query routine from the first item
        queryRecursive()
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
    name: "dummy",
    title: "Select an option...",
    token: () => false
})

export const targetDummy = new TargetService({
    name: "dummy",
    title: "Select an option...",
    token: () => false
})