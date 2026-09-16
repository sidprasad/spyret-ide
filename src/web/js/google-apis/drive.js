window.createProgramCollectionAPI = function createProgramCollectionAPI(collectionName, immediate, publicOnly) {
  function DriveError(err) {
    this.err = err;
  }
  DriveError.prototype = Error.prototype;
  var drive;
  var FOLDER_MIME = "application/vnd.google-apps.folder";
  var BACKREF_KEY = "originalProgram";

  function readClientFile(id, publicRead, resourceKey, metadata) {
    function read(authenticated) {
      var token = BrowserGoogleAuth.current();
      var headers = authenticated && token ? {Authorization: 'Bearer ' + token.access_token} : {};
      if (resourceKey) { headers['X-Goog-Drive-Resource-Keys'] = id + '/' + resourceKey; }
      return Q(fetch('https://www.googleapis.com/drive/' + (metadata ? 'v2' : 'v3') + '/files/' + encodeURIComponent(id) +
        '?' + (metadata ? '' : 'alt=media&') + 'key=' + encodeURIComponent(apiKey), {headers: headers})).then(function(response) {
        if (!response.ok) {
          if (authenticated && response.status === 401) { BrowserGoogleAuth.clear(); }
          var message = 'Google Drive could not read this file (' + response.status + ').';
          if (response.status === 401) { message = 'Reconnect to Google Drive to open this file.'; }
          if (response.status === 403 || response.status === 404) {
            message = authenticated ? 'Cannot open this Drive file. Use an account with access, or ask the owner to share it with you. The file may also have been deleted.' :
              'Connect to Google Drive with an account that has access to this file.';
          }
          var error = new Error(message);
          error.status = response.status;
          throw error;
        }
        return metadata ? response.json() : response.text();
      });
    }
    if (!publicRead) { return read(true); }
    return read(false).catch(function(error) {
      if (BrowserGoogleAuth.current()) { return read(true); }
      throw error;
    });
  }

  function createAPI(baseCollection) {
    function makeSharedFile(googFileObject, fetchFromGoogle) {
      return {
        shared: true,
        getOriginal: function() {
          var request = gapi.client.drive.properties.get({
            'fileId': googFileObject.id,
            'propertyKey': BACKREF_KEY,
            'visibility': 'PRIVATE'
          });
          return request;
        },
        getContents: function() {
          if(fetchFromGoogle) {
            // NOTE(joe): See https://developers.google.com/drive/v2/web/manage-downloads
            // The `selfLink` field directly returns the resource URL for the file, and
            // this will work as long as the file is public on the web.
            var reqUrl = googFileObject.selfLink;
            return Q($.get(reqUrl, {
              alt: "media",
              key: apiKey
            }));
          }
          else {
            return Q($.ajax("/shared-program-contents?sharedProgramId=" + googFileObject.id, {
              method: "get",
              dataType: "text"
            }));
          }
        },
        getName: function() {
          return googFileObject.title;
        },
        getModifiedTime: function() {
          return googFileObject.modifiedDate;
        },
        getUniqueId: function() {
          return googFileObject.id;
        }
      };
    }

    function makeFile(googFileObject, mimeType, fileExtension) {
      return {
        shared: false,
        getName: function() {
          return googFileObject.title;
        },
        getModifiedTime: function() {
          return googFileObject.modifiedDate;
        },
        getUniqueId: function() {
          return googFileObject.id;
        },
        getResourceKey: function() {
          return googFileObject.resourceKey;
        },
        getExternalURL: function() {
          return googFileObject.alternateLink || 'https://drive.google.com/file/d/' + encodeURIComponent(googFileObject.id) + '/view' +
            (googFileObject.resourceKey ? '?resourcekey=' + encodeURIComponent(googFileObject.resourceKey) : '');
        },
        getShares: function() {
          return drive.files.list({
            q: "trashed=false and properties has {key='" + BACKREF_KEY + "' and value='" + googFileObject.id + "' and visibility='PRIVATE'}"
          })
            .then(function(files) {
              if(!files.items) { return []; }
              else { return files.items.map(fileBuilder); }
            });
        },
        getContents: function() {
          if (window.CLIENT_SIDE) { return readClientFile(googFileObject.id, false, googFileObject.resourceKey); }
          var baseUrl = "https://www.googleapis.com/drive/v3/files/" + googFileObject.id + "?alt=media&source=download";
          return Q($.ajax(baseUrl, {
            method: "get",
            dataType: 'text',
            headers: {'Authorization': 'Bearer ' + (gapi.client.getToken() || {}).access_token }
          })).then(function(response) {
            return response;
          });
        },
        rename: function(newName) {
          return drive.files.update({
            fileId: googFileObject.id,
            resource: {
              'title': newName
            }
          }).then(fileBuilder);
        },
        makeShareCopy: function() {
          if (window.CLIENT_SIDE) {
            return Q.reject(new Error('Use Share to link to this file and manage access in Google Drive.'));
          }
          var newFile = shareCollection.then(function(c) {
            return Q($.ajax({
              url: "/create-shared-program",
              method: "post",
              data: {
                fileId: googFileObject.id,
                title: googFileObject.title,
                collectionId: c.id
              }
            }));
          });
          return newFile.then(fileBuilder);
        },
        save: function(contents, newRevision) {
          const boundary = '-------314159265358979323846';
          const delimiter = "\r\n--" + boundary + "\r\n";
          const close_delim = "\r\n--" + boundary + "--";
          var metadata = {
            'mimeType': mimeType,
            'fileExtension': fileExtension
          };
          var multipartRequestBody =
              delimiter +
              'Content-Type: application/json\r\n\r\n' +
              JSON.stringify(metadata) +
              delimiter +
              'Content-Type: text/plain\r\n' +
              '\r\n' +
              contents +
              close_delim;

          var request = gwrap.request({
            'path': '/upload/drive/v2/files/' + googFileObject.id,
            'method': 'PUT',
            'params': {'uploadType': 'multipart'},
            'headers': {
              'Content-Type': 'multipart/mixed; boundary="' + boundary + '"'
            },
            'body': multipartRequestBody});
          return request.then(fileBuilder);
        },
        _googObj: googFileObject
      };
    }

    // The primary purpose of this is to have some sort of fallback for
    // any situation in which the file object has somehow lost its info
    function fileBuilder(googFileObject) {
      if ((googFileObject.mimeType === 'text/plain' && !googFileObject.fileExtension)
          || googFileObject.fileExtension === 'arr') {
        return makeFile(googFileObject, 'text/plain', 'arr');
      } else {
        return makeFile(googFileObject, googFileObject.mimeType, googFileObject.fileExtension);
      }
    }

    var api = {
      getCollectionLink: function() {
        return baseCollection.then(function(bc) {
          return "https://drive.google.com/drive/u/0/folders/" + bc.id;
        });
      },
      getCollectionFolderId: function() {
        return baseCollection.then(function(bc) { return bc.id; });
      },
      getFileById: function(id, resourceKey) {
        if (window.CLIENT_SIDE) {
          return readClientFile(id, false, resourceKey, true).then(function(file) {
            file.resourceKey = file.resourceKey || resourceKey;
            return fileBuilder(file);
          });
        }
        return drive.files.get({fileId: id}).then(fileBuilder);
      },
      makeUrlFile: function(url) {
        return makeUrlFile(url);
      },
      getFileByName: function(name) {
        return this.getAllFiles().then(function(files) {
          return files.filter(function(f) { return f.getName() === name; });
        });
      },
      getCachedFileByName: function(name) {
        return this.getCachedFiles().then(function(files) {
          return files.filter(function(f) { return f.getName() === name; });
        });
      },
      getSharedFileById: function(id, resourceKey) {
        if (window.CLIENT_SIDE) {
          // Read as the recipient, or anonymously with the public API key.
          return readClientFile(id, true, resourceKey, true).then(function(file) {
            file.resourceKey = file.resourceKey || resourceKey;
            var shared = makeFile(file, 'text/plain', 'arr');
            shared.shared = true;
            shared.getOriginal = function() { return drive.properties.get({
              fileId: id, propertyKey: BACKREF_KEY, visibility: 'PRIVATE'
            }); };
            shared.getContents = function() {
              return readClientFile(id, true, file.resourceKey);
            };
            return shared;
          });
        }
        if(!publicOnly) {
          var fromDrive = drive.files.get({fileId: id}, true).then(function(googFileObject) {
            return makeSharedFile(googFileObject, true);
          });
        }
        else {
          var fromDriveQ = Q.defer();
          fromDriveQ.reject("No shared files directly from client with publicOnly=true");
          var fromDrive = fromDriveQ.promise;
        }
        var fromServer = fromDrive.fail(function() {
          return Q($.get("/shared-file", {
            sharedProgramId: id
          })).then(function(googlishFileObject) {
            return makeSharedFile(googlishFileObject, false);
          });
        });
        var result = Q.any([fromDrive, fromServer]);
        result.then(function(r) {
          console.log("Got result for shared file: ", r);
        }, function(r) {
          console.log("Got failure: ", r);
        });
        return result;
      },
      getFiles: function(c) {
        return c.then(function(bc) {
          return drive.files.list({ q: "trashed=false and '" + bc.id + "' in parents" })
            .then(function(filesResult) {
              if(!filesResult.items) { return []; }
              return filesResult.items.map(fileBuilder);
            });
        });
      },
      getCachedFiles: function() {
        return this.getFiles(cacheCollection);
      },
      getAllFiles: function() {
        return this.getFiles(baseCollection);
      },
      createFile: function(name, opts) {
        opts = opts || {};
        var mimeType = opts.mimeType || 'text/plain';
        var fileExtension = opts.fileExtension || 'arr';
        var collectionToSaveIn = opts.saveInCache ? cacheCollection : baseCollection;
        return collectionToSaveIn.then(function(bc) {
          var reqOpts = {
            'path': '/drive/v2/files',
            'method': 'POST',
            'params': opts.params || {},
            'body': {
              'parents': [{id: bc.id}],
              'mimeType': mimeType,
              'title': name
            }
          };
          // Allow the file extension to be omitted
          // (Google can sometime infer from the mime type)
          if (opts.fileExtension !== false) {
            reqOpts.body.fileExtension = fileExtension;
          }
          var request = gwrap.request(reqOpts);
          return request.then(fileBuilder);
        });
      },
      checkLogin: function() {
        return baseCollection.then(function() { return true; });
      }
    };

    if(!publicOnly) {
      var shareCollection = window.CLIENT_SIDE ? Q(null) : findOrCreateDirectory(collectionName + ".shared");
      var cacheCollection = findOrCreateCacheDirectory(collectionName + ".compiled");
    }
    else {
      var shareCollectionQ = Q.defer();
      var cacheCollectionQ = Q.defer();
      shareCollectionQ.reject("No share collection with publicOnly=true");
      cacheCollectionQ.reject("No cache collection with publicOnly=true");
      shareCollection = shareCollectionQ.promise;
      cacheCollection = cacheCollectionQ.promise;
    }

    return {
      api: api,
      collection: baseCollection,
      cacheCollection: cacheCollection,
      shareCollection: shareCollection,
      reinitialize: function() {
        return Q.fcall(function() { return initialize(drive); });
      }
    };
  }

  function findOrCreateDirectory(name) {
    var q = "('me' in owners) and trashed=false and title='" + name + "' and "+
        "mimeType='" + FOLDER_MIME + "'";
    var filesReq = drive.files.list({
      q: q
    });
    var collection = filesReq.then(function(files) {
      if(files.items && files.items.length > 0) {
        return files.items[0];
      }
      else {
        var dir = drive.files.insert({
          resource: {
            mimeType: FOLDER_MIME,
            title: name
          }
        });
        return dir;
      }
    });
    return collection;
  }

  function findOrCreateCacheDirectory() {
    return findOrCreateDirectory(collectionName + ".compiled");
  }

  function initialize(wrappedDrive) {
    drive = wrappedDrive;
    if (window.CLIENT_SIDE && !BrowserGoogleAuth.current()) { publicOnly = true; }
    if(!publicOnly) {
      var baseCollection = findOrCreateDirectory(collectionName);
    }
    else {
      var baseCollectionQ = Q.defer();
      baseCollectionQ.reject("No base collection with publicOnly=true");
      var baseCollection = baseCollectionQ.promise;
    }
    return createAPI(baseCollection);
  }

  var ret = Q.defer();
  Q(gwrap.load({name: 'drive',
              version: 'v2',
              reauth: {
                immediate: immediate,
                publicOnly
              },
              callback: function(drive) {
                ret.resolve(initialize(drive));
              }})).catch(ret.reject);
  return ret.promise;
}

function makeUrlFile(url) {
  const p = Q.defer();
  p.resolve({
    shared: true,
    getOriginal: function() {
      throw new Error("Cannot getOriginal for a file created from a URL")
    },
    getContents: function() {
      const ans = Q.defer();
      fetch(url).then(async function(contents) {
        ans.resolve(await contents.text());
      })
      .catch(function(err) {
        ans.reject(err);
      });
      return ans.promise;
    },
    getName: function() {
      const lastSlash = String(url).lastIndexOf("/");
      if(lastSlash === -1) {
        return url;
      }
      return url.slice(lastSlash + 1);
    },
    getModifiedTime: function() {
      return new Date();
    },
    getUniqueId: function() {
      return url;
    }
  });
  return p.promise;
}
