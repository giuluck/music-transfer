import {Service} from "./service.js"
import {Spotify} from "./spotify.js"
import {Tidal} from "./tidal.js"
import {File} from "./file.js"

// dummy service to handle selections
const dummy = new Service(() => void 0, "Dummy", false)
dummy.login = () => void 0

angular.module("module", ["ngSanitize"]).controller("controller", function ($scope) {
    // set list of available services and default choices
    $scope.services = {
        File: new File(() => $scope.$apply()),
        Tidal: new Tidal(() => $scope.$apply()),
        Spotify: new Spotify(() => $scope.$apply())
    }
    $scope.choices = {
        source: $scope.services[sessionStorage.getItem("source")],
        target: $scope.services[sessionStorage.getItem("target")],
        group: undefined,
        transfers: []
    }
    $scope.transferring = {
        ongoing: false,
        animation: "~~~~~~~~~"
    }

    // update handler for source and transfer change
    $scope.update = role => {
        // retrieve the service and set it to dummy if undefined
        const service = $scope.choices[role] || dummy
        // set the service name in the cache
        sessionStorage.setItem(role, service.id)
        // unless the service is waiting, run the authorization routine
        if (sessionStorage.getItem("waiting") !== role) {
            service.login({done: () => sessionStorage.setItem("waiting", role)})
        }
        // if the source is being changed, either reset the target service if dummy is chosen, otherwise fetch
        if (role === "source") {
            if (service === dummy) {
                $scope.choices.target = undefined
                sessionStorage.removeItem("target")
            } else {
                fetch()
            }
        }
    }

    // transfer handler for button click
    $scope.transfer = () => {
        $scope.choices.transfers = $scope.choices.target.transfer($scope.choices.group)
        $scope.choices.transfers.forEach(transfer => transfer.onReady(_ => {
            $scope.transferring.ongoing = $scope.choices.transfers.some(it => !it.ready)
        }))
        $scope.transferring.animation = ">~~~~~~~~"
        animate()
    }

    // selection handler for batch operations
    $scope.selection = selected => $scope.choices.group.items.map(it => it.selected = selected)

    // recursive routine to animate the transfer string
    function animate() {
        setTimeout(() => {
            if ($scope.transferring.ongoing) {
                const head = $scope.transferring.animation.slice(0, -1)
                const tail = $scope.transferring.animation.slice(-1)
                $scope.transferring.animation = tail + head
                animate()
            } else {
                $scope.transferring.animation = "~~~~~~~~~"
            }
            $scope.$apply()
        }, 200)
    }

    // routine to fetch the data from the source
    function fetch() {
        if (!$scope.choices.source.token) return
        $scope.choices.source.fetch({
            done: () => {
                $scope.error = undefined
                sessionStorage.removeItem("waiting")
                // take groups from $scope.choices.source in case the source has been changed in the meanwhile
                $scope.choices.group = $scope.choices.source.groups[0]
            },
            fail: res => {
                if (res.status === 401) {
                    // if the source token is wrong or expired (Error 401: Unauthorized) clear and run the login again
                    $scope.choices.source.clear()
                    $scope.choices.source.login({done: () => sessionStorage.setItem("waiting", "source")})
                } else {
                    error({
                        service: $scope.choices.source,
                        message: "The server responded with an error after the fetch request",
                        restore: "source",
                        data: res
                    })
                }
            }
        })
    }

    function error({service, message, restore = undefined, data = undefined}) {
        // set the error message and clear the local and the service cache
        $scope.error = message
        sessionStorage.removeItem("waiting")
        service?.clear()
        // if data is passed, log a warning with the given data
        if (data) {
            console.warn(message, data)
        }
        // if restore is passed, reset that service
        if (restore) {
            $scope.choices[restore] = undefined
            $scope.update(restore)
        }
    }

    // if an authentication code is returned, check whether a response is being waited (otherwise, clean the search)
    const params = new URLSearchParams(location.search)
    const code = params.get("code")
    if (code) {
        // check that a service is waiting for the returned code, otherwise log a warning
        const waiting = sessionStorage.getItem("waiting")
        if (waiting) {
            const service = $scope.choices[waiting]
            // check that the yielded state is correct, otherwise log a warning and clear the service cache
            if (params.get("state") === service?.state) {
                // try to log in with the given code
                service.login({
                    code: code,
                    // in case of success, fetch the source data
                    done: () => {
                        sessionStorage.removeItem("waiting")
                        $scope.error = undefined
                        fetch()
                    },
                    // if anything goes wrong, log a warning, clear the service cache, and reset the source service
                    fail: res => error({
                        service: service,
                        message: "The server responded with an error after token exchange request",
                        restore: waiting,
                        data: res
                    })
                })
            } else {
                error({
                    service: service,
                    message: "The server responded with a wrong state code",
                    data: {expected: service?.state, obtained: params.get("state")}
                })
            }
        } else {
            console.warn("A code has been received, but no service is waiting for it")
        }
    }
})