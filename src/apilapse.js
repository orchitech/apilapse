/**
 * Apilapse - a generic issue tracking frontend
 * @preserve Copyright (C) 2015 Textalk AB
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * @license magnet:?xt=urn:btih:0b31508aeb0634b347b8270c7bee4d411b5d4109&dn=agpl-3.0.txt
 *          GNU-AGPL-3.0
 */
angular
  .module('apilapse', ['ui.sortable', 'angularModalService', 'schemaForm'])

  .factory('ConnectionFactory', ['$q', '$http', '$injector', function($q, $http, $injector) {
    var factory = {}

    var configurationsByName = {}
    var promisesByName       = {}

    /**
     * Register a named connection explicitly, from e.g. inlined connection-configuration.
     */
    factory.register = function(connectionName, conf) {
      configurationsByName[connectionName] = conf
    }

    factory.getConnection = function(connectionName) {
      if (connectionName in promisesByName) {return promisesByName[connectionName]}

      var deferred = $q.defer()
      promisesByName[connectionName] = deferred.promise

      if (connectionName in configurationsByName) {
        var conf       = configurationsByName[connectionName]
        var connector  = $injector.get(conf.connector)
        var connection = connector.getConnection(connectionName, conf)

        deferred.resolve(connection)
        return deferred.promise
      }

      $http.get(connectionName)
        .then(
          function(response) {
            var conf       = response.data
            var connector  = $injector.get(conf.connector)
            var connection = connector.getConnection(connectionName, conf)

            deferred.resolve(connection)
          },
          function(error) {
            console.log(error)
            deferred.reject(error)
          })

      return deferred.promise
    }

    return factory
  }])

  .config(function($locationProvider) {
    $locationProvider.html5Mode({enabled: true, requireBase: false}).hashPrefix('!')
  })

  .controller('BoardCtrl', function($scope, $http, $location, ConnectionFactory) {
    $scope.board = {}
    locationSearch = $location.search()
    console.log('Location board', locationSearch)
    $scope.selectedBoard = ('board' in locationSearch ? locationSearch.board : null)

    $http.get($scope.selectedBoard)
      .success(function(data, status, headers, config) {
        if ('connections' in data) {
          for (var connectionName in data.connections) {
            ConnectionFactory.register(connectionName, data.connections[connectionName])
          }
        }
        $scope.board = data

        if ('css' in data) {
          $('head').append('<link rel="stylesheet" href="' + data.css + '" />')
        }
      })
      .error(function(data, status, headers, config) {
        console.log('No board?', data, status, headers, config)
      })
  })

  .directive('boardrow', function() {
    return {
      restrict:    'E',
      scope:       {board:  '='},
      templateUrl: 'view/boardrow.html?v=3',
      replace:     true,
      link: function(scope, element, attrs) {
        for (var i = 0; i < scope.board.rows.length; i++) {
          var selectedColumnSet = scope.board.rows[i].columnSet
          if (typeof selectedColumnSet !== 'undefined') {
              var columns = scope.board.columnSets[selectedColumnSet]
              scope.board.rows[i]["columns"] =  JSON.parse(JSON.stringify(columns))
          }

          // Local board bind must override the inherited bind.
          scope.board.rows[i].bind = $.extend(
            true, {}, scope.board.bind, scope.board.rows[i].bind
          )
          scope.board.rows[i].conf = $.extend(
            true, {}, scope.board.conf, scope.board.rows[i].conf
          )
        }

        scope.$on('newSize', function(event) {
          var totalSize = 0
          for (var i = 0; i < scope.board.rows.length; i++) {
            if (scope.board.rows[i].size) {totalSize = totalSize + scope.board.rows[i].size}
          }
          scope.board.size = totalSize
        })
      }
    }
  })

  .directive('boardcolumns', function() {
    return {
      restrict: 'E',
      scope:    {board:  '='},
      templateUrl: 'view/boardcolumns.html?v=5',
      replace:     true,
      link: function(scope, element, attrs) {
        for (var i = 0; i < scope.board.columns.length; i++) {
          if (!('bind' in scope.board.columns[i])) {scope.board.columns[i].bind = {}}
          if (!('conf' in scope.board.columns[i])) {scope.board.columns[i].conf = {}}
          // Local board bind must override the inherited bind.

          scope.board.columns[i].bind = $.extend(
            true, {}, scope.board.bind, scope.board.columns[i].bind
          )
          scope.board.columns[i].conf = $.extend(
            true, {}, scope.board.conf, scope.board.columns[i].conf
          )
        }

        scope.$on('newSize', function(event) {
          var totalSize = 0
          for (var i = 0; i < scope.board.columns.length; i++) {
            if (scope.board.columns[i].size) {totalSize = totalSize + scope.board.columns[i].size}
          }
          scope.board.size = totalSize
        })
      }
    }
  })

  .directive('board', ['$compile', 'ConnectionFactory', function($compile, ConnectionFactory) {
    return {
      restrict: 'E',
      scope: {
        board: '='
      },
      templateUrl: 'view/board.html?v=2',
      replace:     true,
      link: function(scope, element, attrs) {
        scope.board.size = 0

        scope.$watch('board', function (board) {
          var subboard = element.find('.subboard')

          if (angular.isArray(scope.board.rows)) {
            subboard.empty().append('<boardrow board="board" />')
          }
          else if (angular.isObject(scope.board.rowBind)) {
            scope.board.rows = []

            // Half COPY!  ..fix
            for (connectionName in scope.board.bind) {
              ConnectionFactory.getConnection(connectionName)
                .then(function(connection) {
                  return connection.getIssues(scope.board.bind[connectionName])
                })
                .then(
                  function(issues) {
                    issues.forEach(function(issue) {
                      var row    = $.extend(true, {}, scope.board.rowBind)
                      row.title  = issue.data.title
                      row.parent = issue

                      if ('parent' in row.bind[connectionName]) {
                        row.bind[connectionName].parent = issue.source.id
                      }
                      else {
                        console.log('No parent!')
                      }

                      scope.board.rows.push(row)
                    })
                    //scope.calculateSize()
                  },
                  function(error) {
                    console.log('Error!', error)
                    scope.error = ('error' in scope ? scope.error + '\n' : '') + error
                  }
                )
            }

            subboard.empty().append('<boardrow board="board" />')
          }
          else if (angular.isArray(scope.board.columns)) {
            subboard.empty().append('<boardcolumns board="board" />')
          }
          else if ('bind' in scope.board) {
            console.log('Adding issue board', scope.board)
            subboard.empty().append('<issues board="board" />')
          }
          else {
            console.log('Nothing here')
            subboard.empty()
          }

          // Re-compile after appending directive elements.
          console.log('Recompiling board')
          $compile(element.contents())(scope)
        })
      }
    }
  }])

  .directive('issues', ['$rootScope', 'ConnectionFactory', function($rootScope, ConnectionFactory) {
    return {
      restrict:    'E',
      templateUrl: 'view/issues.html?v=3',
      replace:     true,
      scope:       {
        board: '='
      },
      link: function(scope, element, attrs) {
        console.log('Linked issues')
        scope.board.issues = []

        scope.calculateSize = function() {
          var totalSize = 0
          for (var i = 0; i < scope.board.issues.length; i++) {
            if (scope.board.issues[i].data.size) {
              totalSize = totalSize + parseInt(scope.board.issues[i].data.size)
            }
          }
          scope.board.size = totalSize
          scope.$emit('newSize')
        }

        scope.dragControlListeners = {
          accept: function (sourceItemHandleScope, destSortableScope, destItemScope) {return true},
          itemMoved: function (event) {
            // TODO: Show saving indicator
            var issue = event.source.itemScope.modelValue

            console.log('Event', event)
            if (issue.source.connection in event.dest.sortableScope.$parent.board.bind) {
              console.log('Can move issue easily to new bind in same connection.')

              issue.move(event.dest.sortableScope.$parent.board.bind[issue.source.connection])
                .then(
                  function(result) {
                    scope.calculateSize()
                    event.dest.sortableScope.calculateSize()

                    // TODO: Re-prioritize
                  },
                  function(error) {
                    console.log('Error on move:', error)
                    alert('Error on move:', error)
                  }
                )
              console.log('Move triggered.')
            }
            else {
              console.log('Can NOT move issue easily to new bind in same connection!')
            }
          },
          orderChanged: function(event) {
            var prioAscending = false // TODO: Take from config
            // Eventually configurable
            var defaultPrioStep = 1.0
            var minPrioStep = 0.01

            // Board order vs. priorities example:
            // meaning:  top -> higher -> lower -> bottom
            // indexes:  0    1    2    3   4    5    6
            // prioAsc:  1    2    3    4   null null null
            // prioDesc: null null null 4   3    2    1

            var defaultPrioInc = defaultPrioStep
            if (prioAscending) {
                defaultPrioInc = -defaultPrioStep
            }
            function prioGt(a, b) {
              if (prioAscending && a > b + minPrioStep) {
                return true
              } else if (!prioAscending && a + minPrioStep < b) {
                return true
              }
              return false
            }

            // Window to do prioritizing in
            var windowTopIdx = 0
            var windowBottomIdx = scope.board.issues.length - 1

            // null-padded on top -> start on the first not-null index before destination, if present
            if (!prioAscending) {
              windowTopIdx = event.dest.index
              for (var i = 0; i < event.dest.index; i++) {
                if (scope.board.issues[i].data.prio !== null) {
                  windowTopIdx = i
                  break
                }
              }
            }
            // null-padded on bottom -> end on the last not-null index after destination, if present
            if (prioAscending) {
              windowBottomIdx = event.dest.index
              for (var i = scope.board.issues.length - 1; i > event.dest.index; i--) {
                if (scope.board.issues[i].data.prio !== null) {
                  windowBottomIdx = i
                  break
                }
              }
            }

            // all unset
            if (windowTopIdx == windowBottomIdx) {
              if (prioAscending) {
                windowTopIdx = 0
              } else {
                windowBottomIdx = scope.board.issues.length - 1
              }
            }

            console.log('windowTopIdx: ' + windowTopIdx)
            console.log('windowBottomIdx: ' + windowBottomIdx)

            var prios = new Array(scope.board.issues.length); // playground for changing priorities
            var destIdx = event.dest.index;
            for (var i = 0; i < scope.board.issues.length; i++) {
              prios[i] = scope.board.issues[i].data.prio
            }

            // Start with the happy flow
            if (destIdx > windowTopIdx && destIdx < windowBottomIdx
                && prios[destIdx-1] !== null && prios[destIdx+1] !== null) {
              prios[destIdx] = (prios[destIdx-1] + prios[destIdx+1]) / 2
            } else {
              prios[destIdx] = null;
            }

            // Pick a pivot value for a completely unordered board
            var lastPrio = Math.floor((scope.board.issues.length + 1) / 2) * defaultPrioStep

            for (var i = windowTopIdx; i <= windowBottomIdx; i++) {
              if (prios[i] === null) {
                continue;
              }
              if (i == windowTopIdx || prios[i - 1] == null || prioGt(prios[i], prios[i-1])) {
                lastPrio = prios[i] + (i - windowTopIdx + 1) * defaultPrioInc
                console.log("Window starting prio=" + lastPrio + "; based on prio [" + i + "]=" + prios[i])
                break
              }
            }

            // Do the maths and correct happy flow
            for (var i = windowTopIdx; i <= windowBottomIdx; i++) {
              if (prios[i] !== null && prioGt(prios[i], lastPrio)) {
                lastPrio = prios[i]
                continue
              }
              lastPrio -= defaultPrioInc
              prios[i] = lastPrio
            }

            // Do the work
            for (var i = windowTopIdx; i <= windowBottomIdx; i++) {
              if (scope.board.issues[i].data.prio !== prios[i]) {
                console.log("Setting board prio [" + i + "]=" + prios[i]);
                scope.board.issues[i].setPrio(prios[i])
              }
            }
          }
        };

        scope.reload = function() {
          scope.error = ''
          if (typeof scope.board.bind === 'object') {

            for (connectionName in scope.board.bind) {
              ConnectionFactory.getConnection(connectionName)
                .then(function(connection) {
                  return connection.getIssues(scope.board.bind[connectionName])
                })
                .then(
                  function(issues) {
                    issues.forEach(function(issue) {
                      if ('conf' in scope.board && 'bottomLeft' in scope.board.conf &&
                          issue.data[scope.board.conf.bottomLeft]) {
                        issue.bottomLeft = issue.data[scope.board.conf.bottomLeft]
                      }
                      scope.board.issues.push(issue)
                    })
                    scope.calculateSize()
                  },
                  function(error) {
                    console.log('Error!', error)
                    scope.error = ('error' in scope ? scope.error + '\n' : '') + error
                  }
                )
            }
          }
        }
        scope.reload()
      }
    }
  }])

  .directive('issue', [function() {
    return {
      restrict:    'E',
      templateUrl: 'view/issue_note.html?v=3',
      replace:     true,
      scope:       true
    }
  }])

// @license-end
