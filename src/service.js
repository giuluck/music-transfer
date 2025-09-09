import {All, Transfer} from "./groups.js"

const redirect = location.origin + location.pathname
const alphanumeric = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

// generates a random alphanumeric string
function generate(length) {
    return crypto
        .getRandomValues(new Uint8Array(length))
        .reduce((output, value) => output + alphanumeric[value % alphanumeric.length], "")
}

export class Service {
    #all
    #apply
    #credentials

    constructor(apply, title, token = undefined, credentials = {}) {
        const name = this.constructor.name

        if (name === "Service") {
            throw new Error("Service is an abstract class, therefore it cannot be instantiated")
        }

        // the (short) name of the service, i.e., the class name
        this.name = name.toLowerCase()

        // the (long) title of the service when used as source, if undefined the name is chosen instead
        this.sourceTitle = title || name

        // the (long) title of the service when used as target, if undefined the name is chosen instead
        this.targetTitle = title || name

        // if a token is passed set its value, otherwise try to load it from the session storage
        this.token = token ? token : sessionStorage.getItem(this.name + "Token")

        // whether the service has correctly fetched the results
        this.fetched = false

        // a list of Transfer instances transferred from the source service (initially empty)
        this.transfers = []

        // flag to keep track of when every transfer object has been transferred
        this.finished = false

        // function to update the angular scope
        this.#apply = apply

        // credentials for authentication
        this.#credentials = credentials

        // an "All" object containing all the groups (already fetched or to be fetched)
        this.#all = undefined
    }

    get groups() {
        return this.#all ? [this.#all, ...this.#all.items] : []
    }

    apply() {
        this.#apply()
    }

    select(source) {
        // handles service selection with a boolean representing whether it is selected as source or target
    }

    deselect() {
        // resets the state of the service and its cache
        this.transfers = []
        this.finished = false
        sessionStorage.removeItem(this.name + "State")
        sessionStorage.removeItem(this.name + "Verifier")
    }

    // tries to log into the service in order to get the access token
    login() {
        const deferred = $.Deferred()
        // build and store random state and code verifier for the payload (saved in the storage)
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
            // resolve the deferred, set the waiting flag to this service, then redirect to the authorization link
            .then(challenge => {
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
                deferred.resolve(url)
            })
            // reject the deferred in case of failure
            .catch(res => deferred.reject(res))
        return deferred.promise()
    }

    exchange(code, state) {
        const deferred = $.Deferred()
        if (!this.#credentials) {
            // if authentication is not needed (i.e., no credentials are available) resolve the deferred
            deferred.resolve()
        } else {
            // otherwise, get the expected state and the verifier from the local cache, then reset it (deselect)
            const expectedState = sessionStorage.getItem(this.name + "State")
            const verifier = sessionStorage.getItem(this.name + "Verifier")
            sessionStorage.removeItem(this.name + "Refresh")
            sessionStorage.removeItem(this.name + "Token")
            this.token = undefined
            this.deselect()
            if (state !== expectedState) {
                // if the states do not coincide, reject the deferred passing state info
                deferred.reject({expected: expectedState, obtained: state})
            } else {
                // otherwise, perform the post request using the returned code
                //   > if everything goes well, store the access and the refresh tokens, then resolve the deferred
                //   > otherwise, reject the referred
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
                }).then(res => {
                    sessionStorage.setItem(this.name + "Refresh", res.refresh_token)
                    sessionStorage.setItem(this.name + "Token", res.access_token)
                    this.token = res.access_token
                    deferred.resolve()
                }).catch(res => {
                    deferred.reject(res)
                })
            }
        }
        return deferred.promise()
    }

    // utility function for custom requests after authentication
    _request(url, {method = "GET", message, accept, contentType, ...data} = {}) {
        // call the ajax request passing the bearer token and transforming the data in a string (if present)
        const payload = $.isEmptyObject(data) ? undefined : JSON.stringify(data)
        return $.ajax({
            url: url,
            method: method,
            contentType: contentType,
            headers: {accept: accept, Authorization: "Bearer " + this.token},
            data: payload
        }).then(null, res => {
            // handle failures using "then" so that if a new request has to be sent this is piped to the first one
            switch (res.status) {
                case 401:
                    // in case of missing authorization, refresh the token, store it, and then run the request again
                    return $.ajax({
                        url: this.#credentials.exchangeEndpoint,
                        method: "POST",
                        data: {
                            grant_type: "refresh_token",
                            client_id: this.#credentials.clientID,
                            refresh_token: sessionStorage.getItem(this.name + "Refresh")
                        }
                    }).then(res => {
                        sessionStorage.setItem(this.name + "Refresh", res.refresh_token)
                        sessionStorage.setItem(this.name + "Token", res.access_token)
                        this.token = res.access_token
                        return this._request(url, {
                            method: method,
                            message: message,
                            accept: accept,
                            contentType: contentType,
                            ...data
                        })
                    })
                case 429:
                    // in case of too many requests, wait for 3 seconds (or check the "retry-after" header) and retry
                    const seconds = res.getResponseHeader("retry-after") || 3
                    console.warn("Rate limit exceeded during routine, retrying in " + seconds + " seconds", res)
                    // use a promise for the timeout to adhere to the "thenable" objects needed to pipe requests
                    return new Promise(resolve => setTimeout(resolve, seconds * 1000))
                        .then(() => this._request(url, {
                            method: method,
                            message: message,
                            accept: accept,
                            contentType: contentType,
                            ...data
                        }))
                default:
                    // in any other case, log a warning if needed, then let jQuery reject the request
                    if (message) {
                        console.warn(message, {
                            res: res,
                            url: url,
                            method: method,
                            accept: accept,
                            contentType: contentType,
                            payload: payload,
                            ...data
                        })
                    }
                    return res
            }
        })
    }

    // utility routine to fetch data asynchronously within groups
    _fetchRoutine({url, routine}) {
        // create a function to recursively fetch items until a new link is given
        const fetchRecursive = (link, group) => {
            // if the link is undefined, the fetching process is completed, otherwise send a request to the url
            if (!link) {
                group.complete()
                this.apply()
                return
            }
            // in case of success, add the new items to the group then call the recursive function with the new url
            // otherwise, call the recursive function with the undefined url to stop the fetching
            this._request(link, {message: "Error during recursive fetch"})
                .then(res => {
                    const output = routine(res)
                    group.add(output.items)
                    this.apply()
                    fetchRecursive(output.url, group)
                })
                .catch(() => fetchRecursive(undefined, group))
        }
        // return the fetch routine as a call to the recursive function given a group
        return group => fetchRecursive(url, group)
    }

    // utility routine to transfer data asynchronously within groups
    _transferRoutine({process, query, push, limit, transfer}) {
        let items = transfer.items.map(it => it.data)
        // build a recursive push routine which pushes the queried data in batches of "limit" size
        const pushRecursive = index => {
            const batch = items.slice(index, index + limit)
            if (batch.length === 0) {
                // if the sliced data is empty, the transferring is completed
                transfer.complete()
            } else {
                // otherwise, try to push the batch and add the whole batch to the missing list in case of failure
                // eventually, call the recursive function with updated index
                const {url, ...config} = push(batch.map(it => it[this.name]))
                this._request(url, {
                    message: "Error during recursive recursive push",
                    ...config
                }).catch(() => {
                    transfer.missing.push(...batch)
                }).always(() => {
                    transfer.increment(batch.length)
                    pushRecursive(index + batch.length)
                    this.apply()
                })
            }
        }
        // build a recursive query routine that queries a single item
        // (this is due to the fact that services provide filtering options to search for one item at the time)
        const queryRecursive = index => {
            // when all the items have been transferred, keep only those that have service data (non-missing)
            // then reset the number of transferred items and start to push them into the service without other queries
            if (transfer.items.length === transfer.transferred) {
                items = items.filter(it => it[this.name] !== null)
                transfer.increment(-items.length)
                pushRecursive(0)
                return
            }
            // otherwise, increment the number of transferred items and get the item at the given index
            //   > if the data relative to this service is already available, simply pass to the next index
            //   > otherwise, query the data and handle the result
            transfer.increment(1)
            const item = items[index]
            if (item[this.name] !== undefined) {
                queryRecursive(index + 1)
            } else {
                // in case a non-empty result is returned, assign it to the item at the service.name field
                // otherwise (or in case an error occurs) set the field to "null" and push the item in the missing
                // eventually, pass to the next index after 0.5 seconds to avoid too many requests
                const url = query(item)
                this._request(url, {
                    message: "Error during recursive recursive query"
                }).then(res => {
                    const id = process(res, item)[0]
                    if (id) {
                        item[this.name] = id
                    } else {
                        item[this.name] = null
                        transfer.missing.push(item)
                    }
                }).catch(() => {
                    item[this.name] = null
                    transfer.missing.push(item)
                }).always(() => {
                    setTimeout(() => queryRecursive(index + 1), 500)
                    this.apply()
                })
            }
        }
        // start the query routine from the first item
        queryRecursive(0)
    }

    fetch() {
        const deferred = $.Deferred()
        if (this.fetched) {
            // if the service was already fetched, resolve the referred
            deferred.resolve()
        } else {
            // otherwise, set the fetched status to true to avoid multiple calls and call the routine
            this.fetched = true
            this._fetch().then(res => {
                // if the routine succeed, assign the groups and resolve the deferred
                this.#all = res
                deferred.resolve()
            }).catch(res => {
                // if it fails, restore the fetched status to false and reject the deferred
                this.fetched = false
                deferred.reject(res)
            })
        }
        return deferred.promise()
    }

    transfer(group) {
        // if the input is an "All" instance get the selected items, otherwise build a list out of the single group
        const groups = group instanceof All ? group.items.filter(it => it.selected) : [group]
        // build a new transfer object for each single group and start the transfer when the group is ready
        this.transfers = groups.map(group => {
            const transfer = new Transfer(group)
            group.deferred.then(() => this._transfer(transfer))
            return transfer
        })
        // set the status to finished when all the transfer promises have been resolved
        $.when(...this.transfers.map(it => it.deferred)).then(() => this.finished = true)
    }

    // protected fetch function called from the public "fetch" one
    _fetch() {
    }

    // protected transfer function called from the public "transfer" one
    _transfer(transfer) {
    }
}

export class Dummy
    extends Service {
    constructor(apply) {
        super(apply, "Select an option...", false)
    }

    login() {
        return $.when()
    }
}