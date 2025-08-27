import {redirect, Service} from "./service.js"
import {Spotify} from "./spotify.js"
import {Tidal} from "./tidal.js"
import {Text} from "./text.js"

// dummy service to handle selections
const dummy = new Service()
dummy.name = "Select an option..."
dummy.disabled = true
dummy.set = _ => undefined

angular.module("module", ["ngSanitize"]).controller("controller", function ($scope) {
    // set list of available services
    $scope.services = {
        null: dummy,
        Text: new Text(() => $scope.$apply()),
        Tidal: new Tidal(() => $scope.$apply()),
        Spotify: new Spotify(() => $scope.$apply())
    }

    // handle results and choices
    const source = $scope.services[sessionStorage.getItem("source")]
    const target = $scope.services[sessionStorage.getItem("target")]
    $scope.results = undefined
    $scope.choices = {
        source: source.token() ? source : dummy,
        target: target.token() ? target : dummy,
        transfer: undefined
    }

    // handle requests failure and success, along with fetch routine
    $scope.error = false
    $scope.failure = (message, data) => {
        console.warn(message, data)
        sessionStorage.removeItem("waiting")
        $scope.error = true
        $scope.$apply()
    }
    $scope.success = (role, service) => {
        sessionStorage.setItem(role, service)
        sessionStorage.removeItem("waiting")
    }
    $scope.fetch = () => {
        // if either the source and the target have not been authorized with a token, stop the routine
        if (!$scope.choices.source.token() || !$scope.choices.target.token()) return
        // fetch results from the source service
        $scope.choices.source.fetch()
            // assign the overall results and the transfer selection in case of successful request
            .done(res => {
                $scope.choices.transfer = res[0]
                $scope.results = res
                $scope.$apply()
            })
            // clear the session cache if the source token is wrong or expired (Error 401: Unauthorized)
            .fail(res => {
                if (res.status === 401) {
                    $scope.choices.source.clear()
                    $scope.choices.source = dummy
                }
                $scope.failure("Error after source export request", res)
            })
    }

    // if an authentication code is returned, check whether a response is being waited (otherwise, clean the search)
    const params = new URLSearchParams(location.search)
    const code = params.get("code")
    if (code) {
        // check that:
        //   - a service is waiting for the returned code
        //   - the yielded state is correct and run the request for the token
        // if anything goes wrong, call the warning function with custom messages and data
        const waiting = sessionStorage.getItem("waiting")
        if (waiting) {
            const [role, name] = waiting.split(" ")
            const service = $scope.services[name]
            if (params.get("state") === service.state()) {
                service.exchange(code)
                    // if the request succeeded, call the request routine and redirect to the entry point
                    .done(_ => {
                        console.log("here")
                        $scope.success(role, name)
                        location.href = redirect
                    })
                    // otherwise, clear the service cache and call the failure routine
                    .fail(res => {
                        service.clear()
                        $scope.failure("Error after token exchange request", res)
                    })
            } else {
                $scope.failure("Wrong state yielded by the server", {
                    expected: service.state(),
                    obtained: params.get("state")
                })
            }
        } else {
            console.warn("Code received, but no service is waiting for it")
        }
    }

    // try to fetch in case both services are available
    $scope.fetch()

    // authorization handler for options
    $scope.authorize = role => {
        // retrieve the current service
        const service = $scope.choices[role]
        // if a token is already available, call the success routine and try to fetch
        // otherwise store the waiting response flag and redirect to the authorization url
        if (service.token()) {
            $scope.success(role, service.name)
            $scope.fetch()
        } else {
            sessionStorage.setItem("waiting", role + " " + service.name)
            service.authorize()
        }
    }

    $scope.transfer = () => {
        $scope.choices.target.transfer($scope.choices.transfer)
    }

    // selection handler for batch operations
    $scope.selection = selected => {
        $scope.choices.transfer.items.map(item => item.selected = selected)
    }
})