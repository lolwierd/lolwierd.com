---
title: "The spec was lying"
summary: "i wrote an OpenAPI library. one of its features has never worked outside its own repo."
date: 2026-08-28
tags: [tech, go, openapi]
---

I wrote a library called weave a couple of years ago. It wraps a Go HTTP router
so you write your handlers once and get an OpenAPI 3.1 document out of the same
types, by reflection. No YAML to keep in sync, no annotation comments stacked
above every handler. The Go types are the contract.

It has been running a public cloud's API since. The docs UI customers read comes
out of it, and so does a Terraform provider.

Last week I went back to strip out the company-specific parts so I could put a
public version up somewhere. I did not get very far. One of the features I was
proudest of has never worked for anybody but me, and two of the design decisions
work against the whole point of it.

---

## the part that was right

The bet underneath it holds. If the Go type is the only description of an
operation, the document cannot drift from the code, because there is nothing to
drift from.

```go
weave.PostJSON[CreateRequest, CreateResponse](w, "/things", handler,
    weave.RouteOptions{OpenAPIOptions: weave.OpenAPIOptions{
        Summary: "Create a thing",
    }},
)
```

Reflection walks `CreateRequest`, emits a JSON schema, registers it under
`#/components/schemas`, wires it into the operation, and parses the incoming body
into that same type at runtime. Add a field and the docs have it. Rename one and
the docs follow. Nobody has to remember to update a spec file, which matters,
because nobody does.

Two years in, I would not go back to writing OpenAPI by hand.

---

## the feature that only worked on my machine

Somewhere in year two I added a thing I was pleased with. Your Go doc comments
become your schema descriptions.

```go
// CreateRequest asks for a new thing.
type CreateRequest struct {
    // Name is the label people will see.
    Name string `json:"name"`
}
```

Struct tags get compiled into the binary, so reflection reads them at runtime.
Doc comments do not. They only exist in `.go` files. So the implementation
resolves the package's source directory out of `debug.ReadBuildInfo()`, parses
the files with `go/parser`, and pulls the comments out of the AST.

There is a test for it. The test passes. I wrote an example, ran it, saw the
descriptions in the docs UI, and moved on.

Last week I made a throwaway module outside the library, imported weave, and
printed the generated components.

```json
{"Widget":{"properties":{"name":{"type":"string"}},"required":["name"],
"title":"Widget","type":"object"}}
```

No descriptions anywhere in it. I sat looking at that for a while, because I had
watched this work.

The resolver walks the module list out of the build info. For a dependency it
finds the module cache, so that path works. For the main module,
which is to say your service and your types and the comments you actually sat
down and wrote, the version string is empty, so it falls through to
`filepath.Abs(m.Path)`. That turns the module *path* `example.com/doctest` into
`$PWD/example.com/doctest`, a directory which does not exist. `build.ImportDir`
fails. The function returns an empty string, and an empty string means "no doc
comment on this type", which is the same answer it gives for a type nobody
documented.

The test passes because it lives inside the library, where the main module is
weave itself, and there is a special case that resolves that one correctly with
`runtime.Caller`. My example worked for the same reason. Every place I ever
looked at this feature was the one place it worked.

Fixing the resolver would not save it either. The service ships as a static
binary in a scratch image. There is no source tree in the container to parse. The
best available version of this feature gives you complete descriptions on your
laptop and none of them in production, quietly, both times.

Nobody caught it for a year because the docs UI is served off a route on a
running service, and the schemas it shows are correct. Just bare. Which reads as
"nobody wrote comments on that one", and that is usually true, so it never looked
like a bug.

Doc comments are a build-time fact, so they have to come out at build time and
get compiled in, next to the struct tags they were sitting beside the whole time.
That is a generator and a `go:generate` line. It is not a hard fix. It is just
not the fix I wrote.

---

## the same constraint, written twice

weave validates request bodies with `go-playground/validator` tags, and then
separately converts those same tags into OpenAPI constraints so the docs show
them.

```go
Name string `json:"name" validate:"required,min=3,max=50"`
```

There is a table in the code mapping about twenty validator tags onto their
schema equivalents. `min` becomes `minLength` on a string, `minItems` on an
array, `minimum` on a number. `gt` becomes `exclusiveMinimum`, except on strings
and arrays, where it becomes `minLength: value+1`, because JSON Schema has no
exclusive length.

Every row in that table is somewhere the document and the server can come apart,
and a few of them already have. `regexp=^[a-z,0-9]+$` truncates at the comma,
because commas are how validator separates its rules. So the spec advertises
`^[a-z` and the server enforces `^[a-z`. They agree with each other and they are
both wrong.

There is a second validation path as well: a `Validatable` interface with a
`Validate() error` method, and if your type implements it the tag path gets
skipped entirely. Whatever that method checks appears nowhere in the document.
The client gets a 400 for a rule the spec never mentioned.

None of this is necessary. You are already generating a JSON Schema, and JSON
Schema is a validation language. Validate against the schema you emitted and the
two cannot disagree, because they are the same object in memory.

---

## two ways to register a route, one of them lies

The typed one infers everything from the generics:

```go
weave.PostJSON[Req, Resp](w, "/things", handler, opts)
```

The untyped one takes a `*fiber.Ctx` handler plus whatever you tell it about the
types:

```go
w.Post("/things", handler, weave.RouteOptions{OpenAPIOptions: weave.OpenAPIOptions{
    RequestBody:  Req{},
    ReponseBody:  Resp{},
}})
```

That second one is the drift the library exists to prevent, relocated inside the
library. You hand it a type and it takes your word. Change the handler and the
`RequestBody` line sitting eight lines up still says what it always said.

I would have defended this. The typed one is right there, just use it. Then I
went and looked at where `HandleJSON` actually registers the route, which is
against the root app, never against a group. So the moment you want a path prefix
or a shared tag or group middleware, the typed API is not available and you drop
back to the one that takes your word for things. On a real service that is most
of the routes. Nobody picked the escape hatch. There was a missing feature and
everybody walked around it.

(The field is also spelled `ReponseBody`. In public. In every route file. Two
years and a great many call sites later, the typo is load-bearing.)

---

## handlers that know too much

Every weave handler takes `*fiber.Ctx`, which is convenient right up until it is
not.

Testing one means building a fiber context, or standing up an app and firing HTTP
at it, for a function whose real job is id in, thing out. Fiber v2 is in
maintenance and v3 changed the context API, so that migration is every handler in
the codebase.

And path parameters never made it into the typed request struct at all. `GetJSON`
parses the query string and stops there, so any route with an `:id` in it reaches
for `c.Params("id")` by hand, inside the handler that was supposed to be typed,
for the one value the router definitely already knows.

Headers and cookies got their own parallel helper families instead. `GetHeaders`,
`PostHeaders`, `GetCookies`, `PostCookies`, one per verb per source, none of them
combinable. You cannot take headers and a body in the same typed handler.

A request has a path, a query string, headers, cookies and a body, and it is
still one request. I do not know why I modelled it as four.

---

## what I'd build instead

So I wrote it, because arguing about design is cheap and code is not. It is
called [loom](https://github.com/lolwierd/loom), which is what the main type
inside weave was already called, and I like it better as a name for the whole
thing.

A handler is a function.

```go
type GetVM struct {
    ID     string   `path:"id"`
    Fields []string `query:"fields" enum:"status,volumes"`
    Trace  string   `header:"X-Trace-Id"`
}

func getVM(ctx context.Context, req GetVM) (VM, error) { ... }

loom.Get(api, "/vms/{id}", getVM, loom.Summary("Fetch a VM"))
```

No router type in the signature, so testing a handler is calling the handler.
Path, query, header, cookie and body all bind into one struct, and where each
field comes from is written on the field.

Constraints are JSON Schema keywords, because the output is JSON Schema.

```go
Name  string `json:"name" minLength:"3" maxLength:"50"`
Email string `json:"email" format:"email"`
Role  string `json:"role" enum:"admin,member"`
```

Those go into the document unchanged, and validation runs against the same
`*Schema` value the document was rendered from. One vocabulary, no conversion
table.

Doc comments come out at build time, from a generator you run under
`go:generate` that walks the source with `go/ast` and writes them into a Go file.

Everything the reflection walk finds wrong gets collected and handed back:

```
loom: 3 registration problem(s):
  - request field badReq.Missing binds path parameter "nope", which is not in the route pattern
  - request field badReq.Untagged has no path/query/header/cookie/body tag; it would never be populated
  - request field badReq.Weird: type chan int cannot be bound from a string; use a body field
```

Registration happens once, at startup, before a single request is served, so all
of that is knowable right then. weave recovers from panics during parameter
inference, logs a line, and serves a document that is missing the parameters it
could not work out.

There is also no untyped path this time. Groups and middleware compose with the
typed handlers, so there is nothing to want one for.

One more thing falls out of building it this way. The document stops being
something you only get by starting the process. loom's spec is a checked-in file, produced by a golden test:

```go
func TestSpec(t *testing.T) {
    loomtest.Golden(t, buildAPI(), "testdata/openapi.json")
}
```

`go test` fails when the code and the document disagree, and a PR that changes an
API shows the spec diff sitting next to the change that caused it. The Terraform
generator reads a file instead of booting a service to interview it.

---

## what it costs

The obvious objection to validating every request body against a schema is that
it must cost something, so I measured it. `wrk -t4 -c100 -d10s`, a handler that
does nothing except touch a slice, on a laptop. Requests per second:

| | GET | POST, full body validation |
|---|---|---|
| raw Fiber, hand-written | 208,366 | 205,039 |
| weave on Fiber | 202,958 | 205,358 |
| loom on Fiber | 208,885 | 185,109 |
| loom on net/http | 101,570 | 102,239 |

Reads are free. Validating every body against its schema runs about ten percent
on a handler that does no actual work, and that share only gets smaller once the
handler does something. That seems like a reasonable trade for not being able to
document a constraint you are not enforcing.

The row I did not expect is the last one. loom's core has no dependencies and its
default adapter is `net/http`, which turns out to be about half the throughput of
fasthttp on this benchmark. That is a far bigger number than anything the
abstraction costs. The Fiber adapter is forty lines in a separate module, and
there is a test asserting that both adapters produce the same responses and the
same spec, byte for byte.

---

## what I actually got wrong

I keep reaching for a takeaway about testing, or about being careful with
reflection, and neither one holds up. The test passed every day for a year.

The honest version is smaller and worse. weave makes one promise, which is that
the document tells the truth about the server, and I never went back to check new
features against it once they shipped. Runtime source parsing breaks that promise
in production and nowhere else. The tag conversion table
breaks it on whichever row nobody reads. The untyped registration path breaks it
wherever somebody needed a group prefix. None of that shows up as a failure you
can look at; it shows up some weeks later as a customer who wrote their client
off the docs and got a 400 for it.

So the module path resolution is not the interesting bug. I built something whose
failure mode is silence, and then only ever ran it from inside its own repo.
