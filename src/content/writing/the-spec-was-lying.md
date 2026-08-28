---
title: "The spec was lying"
summary: "I built a Go library that generates OpenAPI from your types. Then I found the bug that only exists in production."
date: 2026-08-28
tags: [tech, go, openapi]
---

I wrote a library called weave a couple of years ago. It wraps a Go HTTP router so that
you write your handlers once and get an OpenAPI 3.1 document out the other side,
generated from your request and response structs by reflection. No YAML to keep
in sync, no annotation comments above every handler. Your Go types are the
contract.

It has been running a public cloud's API since. The documentation UI customers
read is generated from it, and so is a Terraform provider.

I went back through it last week to pull out anything company-specific and put a
public version somewhere. What I found instead was that one of its headline
features has never worked for anyone but me, and that a couple of its design
decisions quietly undo the thing the whole library exists to do.

---

## the part that was right

The core bet holds up. If the Go type is the only description of an operation,
the document cannot drift from the code, because there is nothing to drift from.

```go
weave.PostJSON[CreateRequest, CreateResponse](w, "/things", handler,
    weave.RouteOptions{OpenAPIOptions: weave.OpenAPIOptions{
        Summary: "Create a thing",
    }},
)
```

Reflection walks `CreateRequest`, emits a JSON schema, registers it under
`#/components/schemas`, wires it into the operation, and parses the incoming
body into that same type at runtime. Add a field, the docs have it. Rename one,
the docs follow. Nobody ever has to remember to update a spec file, which is
good, because nobody ever does.

That part works, and after two years of it I would not go back to writing
OpenAPI by hand.

---

## the feature that only worked on my machine

Somewhere in year two I added something I was pleased with: your Go doc comments
become your schema descriptions.

```go
// CreateRequest asks for a new thing.
type CreateRequest struct {
    // Name is the label people will see.
    Name string `json:"name"`
}
```

Struct tags are compiled into the binary, so reflection can read them at runtime.
Doc comments are not. They exist only in `.go` files. So the implementation
resolves the package's source directory from `debug.ReadBuildInfo()`, parses the
files with `go/parser`, and pulls the comments out.

There is a test for it. The test passes. I wrote an example, ran it, saw the
descriptions in the docs UI, and moved on.

Last week I made a scratch module outside the library, imported it, and printed
the generated components:

```json
{"Widget":{"properties":{"name":{"type":"string"}},"required":["name"],
"title":"Widget","type":"object"}}
```

No descriptions. Not one.

The directory resolution walks the module list from the build info. For a
dependency it can find the module cache. For the **main** module — your service,
your types, the ones you actually wrote comments on — the version string is
empty, so it falls through to `filepath.Abs(m.Path)`, which turns the module
*path* `example.com/doctest` into `$PWD/example.com/doctest`. That directory does
not exist. `build.ImportDir` fails. The function returns an empty string, and an
empty string means "this type has no doc comment," which is indistinguishable
from a type nobody documented.

The test passes because the test lives inside the library, where the main module
*is* the library, and there is a special case that resolves that one correctly
using `runtime.Caller`. The example worked for the same reason.

And even if the resolution were fixed, the design cannot work. The service ships
as a static binary in a scratch image. There is no source tree in the container.
The best possible version of this feature produces a complete spec in
development and a spec with every description stripped in production, and reports
no error either time, because a missing file and an undocumented type return the
same empty string.

I had shipped a feature that is architecturally incapable of running where the
software runs. Nobody noticed for a year because the internal docs UI is served
from a spec route on a service, and the schemas it shows are correct — just
undescribed, which reads as "we didn't write comments on that one."

The fix is not a better path resolver. Doc comments are a build-time fact, so
they have to be extracted at build time and compiled in, like the struct tags
they sit next to.

---

## two vocabularies for one constraint

weave validates request bodies with `go-playground/validator` tags, and
separately converts those tags into OpenAPI constraints so the docs show them:

```go
Name string `json:"name" validate:"required,min=3,max=50"`
```

There is a table in the code mapping about twenty validator tags to their schema
equivalents. `min` becomes `minLength` on a string, `minItems` on an array,
`minimum` on a number. `gt` becomes `exclusiveMinimum`, except on strings and
arrays where it becomes `minLength: value+1`, because JSON Schema has no
exclusive length.

Every one of those rows is a place the document and the server can disagree, and
some of them already do. `regexp=^[a-z,0-9]+$` silently truncates at the comma,
because commas separate validator rules — so the spec advertises `^[a-z` and the
server enforces `^[a-z`, and both of them are wrong in the same interesting way.
There is a second validation path too, a `Validatable` interface with a
`Validate() error` method, and when a type implements it the tag path is skipped
entirely. Whatever that method checks appears nowhere in the document. Clients
get a 400 for a rule the spec never mentioned.

You do not need two vocabularies. You are already generating a JSON Schema. JSON
Schema is a validation language. Validate the request against the schema you
emitted, and the two cannot disagree, because they are the same object in memory.

---

## the escape hatch that eats the thesis

weave has two ways to register a route. The typed one infers everything:

```go
weave.PostJSON[Req, Resp](w, "/things", handler, opts)
```

The untyped one takes a `*fiber.Ctx` handler and whatever you claim about it:

```go
w.Post("/things", handler, weave.RouteOptions{OpenAPIOptions: weave.OpenAPIOptions{
    RequestBody:  Req{},
    ReponseBody:  Resp{},
}})
```

The second one is the drift the library exists to prevent, moved inside the
library. You hand it a type and it believes you. Change the handler, and the
`RequestBody` line sitting eight lines away still says what it always said.

I would have argued this was fine — the typed one is right there, just use it.
Except the generic helpers register against the root app, not against a group.
So the moment you want a path prefix, a shared tag, or group middleware, the
typed API is not available to you and you fall back to the one that can lie.
Which is to say: on any real service, most routes go through the path with no
guarantees. That is not an escape hatch anyone chose. It is a missing feature
that pushed everybody onto the wrong door.

(The field is also spelled `ReponseBody`, in public, in every route file. Two
years and a great many call sites deep, that typo is load-bearing.)

---

## handlers that know too much

Every weave handler takes `*fiber.Ctx`. That is convenient right up until it is
not:

- testing a handler means constructing a fiber context, or standing up an app
  and firing HTTP at it, for a function whose actual job is `id in, thing out`
- Fiber v2 is in maintenance and v3 changed the context API, so the migration
  is every handler in the codebase
- path parameters never made it into the typed request struct at all. `GetJSON`
  parses the query string and nothing else, so any route with an `:id` in it
  reaches into `c.Params("id")` by hand — inside the handler that was supposed
  to be typed, for the one parameter the router definitely knows about

Header and cookie binding got their own parallel helper families —
`GetHeaders`, `PostHeaders`, `GetCookies`, `PostCookies` — each one a verb
crossed with a source, none of them combinable. You cannot have headers and a
body in the same typed handler. You pick one.

There is one request. It has a path, a query string, headers, cookies and a
body. It should be one struct.

---

## what I'd build instead

I wrote it, because an argument about design is cheap and code is not. It is
called [loom](https://github.com/lolwierd/loom) — which is what the main type
inside weave was already called, and I like it better as the name of the thing.

A handler is a function:

```go
type GetVM struct {
    ID     string   `path:"id"`
    Fields []string `query:"fields" enum:"status,volumes"`
    Trace  string   `header:"X-Trace-Id"`
}

func getVM(ctx context.Context, req GetVM) (VM, error) { ... }

loom.Get(api, "/vms/{id}", getVM, loom.Summary("Fetch a VM"))
```

No router type in the signature, so testing a handler is calling it. Path, query,
header, cookie and body all bind into one struct, and where each field comes from
is written on the field.

Constraints are JSON Schema keywords, because the output is JSON Schema:

```go
Name  string `json:"name" minLength:"3" maxLength:"50"`
Email string `json:"email" format:"email"`
Role  string `json:"role" enum:"admin,member"`
```

Those go into the document unchanged, and request validation runs against the
same `*Schema` value the document was rendered from. One vocabulary, no
conversion table, nothing to keep in sync.

Doc comments are extracted by a generator under `go:generate` that walks the
source with `go/ast` and writes them into a Go file. Build-time facts get
compiled in.

Everything the reflection walk finds wrong is collected and returned:

```
loom: 3 registration problem(s):
  - request field badReq.Missing binds path parameter "nope", which is not in the route pattern
  - request field badReq.Untagged has no path/query/header/cookie/body tag; it would never be populated
  - request field badReq.Weird: type chan int cannot be bound from a string; use a body field
```

Registration happens once, at startup, before anything is served. Every one of
those is knowable then. weave recovers from panics during parameter inference,
logs a line, and serves a document missing the parameters it could not work out.

And there is no untyped registration path. Groups, middleware and typed handlers
compose, so there is no reason to want one.

There is one more thing that falls out of doing it this way. The document stops
being something you get by starting the process. loom's spec is a checked-in file
produced by a golden test:

```go
func TestSpec(t *testing.T) {
    loomtest.Golden(t, buildAPI(), "testdata/openapi.json")
}
```

`go test` fails when the code and the document disagree, and a pull request that
changes an API shows the spec diff next to the change that caused it. The
Terraform generator and the client generators read a file instead of booting a
service to interview it.

---

## what it costs

The obvious objection to validating every request body against a schema is speed,
so I measured it. `wrk -t4 -c100 -d10s` against a handler that does nothing but
touch a slice, on a laptop, requests per second:

| | GET | POST, full body validation |
|---|---|---|
| raw Fiber, hand-written | 208,366 | 205,039 |
| weave on Fiber | 202,958 | 205,358 |
| loom on Fiber | 208,885 | 185,109 |
| loom on net/http | 101,570 | 102,239 |

Reads are free. Validating every body against its schema costs about ten percent
on a handler that does no work at all, and that share only shrinks once the
handler does something. Nobody's p99 is a JSON Schema check.

The interesting row is the last one. loom's core has no dependencies and its
default adapter is `net/http`, which is half the throughput of fasthttp on this
benchmark — a much larger number than anything the abstraction costs. The Fiber
adapter is forty lines in a separate module. Same handlers, same document, byte
for byte; there is a test that asserts it.

---

## the actual lesson

Not "use reflection carefully," or "write more tests." The test for the doc
comment feature passed for a year.

It is that a library like this has exactly one promise — the document tells the
truth about the server — and every feature has to be checked against it. Runtime
source parsing breaks it in production and nowhere else. A tag conversion table
breaks it once, on the row nobody reads. An untyped registration path breaks it
wherever a group prefix was needed. None of those show up as a failure. They show
up as a customer who wrote their client against the docs and got a 400.

The bug I care about is not the module path resolution. It is that I built
something whose failure mode is silence, and then only looked at it from the one
place where it worked.
