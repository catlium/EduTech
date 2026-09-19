---

name: project-diagrams
description: Analyze a software codebase and generate accurate, professional technical diagrams from the implemented system. Use when the user asks to create, generate, update, review, or document technical diagrams, system architecture, UML, data models, workflows, processes, infrastructure, security flows, or other software design diagrams from a repository.
--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

# Project Diagrams

## Purpose

Generate professional technical diagrams from the **actual implementation of a software project**.

The skill must remain completely generic:

* Do not assume a specific technology stack.
* Do not assume a specific application domain.
* Do not assume the project is for college, documentation, presentations, or any other specific purpose.
* Do not assume which diagrams are required.
* Discover the project structure, technologies, architecture, and domain from the repository.

The repository is the primary source of truth.

---

## When to Use This Skill

Use this skill when the user asks to:

* Generate technical diagrams
* Create diagrams from the codebase
* Document system architecture
* Create UML diagrams
* Create database/data-model diagrams
* Visualize workflows or processes
* Document system interactions
* Document deployment or infrastructure
* Visualize security/authentication flows
* Update diagrams after implementation changes
* Review existing technical diagrams against the implementation
* Generate a complete set of useful project diagrams

If the user explicitly says:

> Use the project-diagrams skill

the skill must be used for the request.

The skill may also be selected automatically when the user's request clearly matches the description above.

---

## Core Principle

**Code first. Diagram second.**

Never design diagrams based primarily on assumptions, generic templates, or what the project is expected to contain.

First inspect the implementation.

Then derive the diagrams from verified evidence.

---

# Workflow

## 1. Read Project Instructions

Before inspecting the implementation:

* Read applicable `AGENTS.md` files.
* Read relevant repository documentation.
* Respect project-specific instructions.
* Check existing documentation and diagram conventions.
* Determine where generated documentation belongs.

Do not modify project conventions unnecessarily.

---

## 2. Identify the Technology Stack

Determine the actual stack from the repository.

Inspect, where applicable:

* Package manifests
* Lockfiles
* Build configuration
* Source directories
* Database configuration
* Infrastructure configuration
* Container configuration
* CI/CD configuration
* API definitions
* ORM/schema definitions
* Configuration files
* Existing documentation

Identify only technologies that are actually evidenced by the repository.

---

## 3. Understand the System

Build an internal model of:

* Applications/services
* Major modules
* Important components
* Data stores
* External integrations
* APIs
* Background jobs
* Message/event flows
* Authentication and authorization
* Major business entities
* Important user/system interactions
* Deployment relationships

Do not expose the internal reasoning process.

Only use the resulting verified model to construct diagrams.

---

# Diagram Selection

Do not automatically generate every possible diagram.

Select diagrams based on:

1. Evidence available in the repository
2. Architectural importance
3. Complexity
4. Documentation value
5. User request
6. Whether the diagram communicates something meaningfully different from another diagram

Possible categories include:

### Architecture

* System architecture
* Application/component architecture
* Service architecture
* Module architecture

### UML

* Use case
* Class
* Sequence
* Activity
* State
* Component

### Data

* ER/data model
* Database schema
* Data relationships

### Process

* Workflow
* Activity/process flow
* Business process
* State transition

### Interface

* API interaction
* Request/response flow
* Client-server interaction

### Infrastructure

* Deployment
* Runtime topology
* Container/infrastructure architecture

### Security

* Authentication flow
* Authorization flow
* Security boundary/trust flow

Only generate diagrams that can be supported by actual project evidence.

---

# Evidence Requirements

## Architecture Diagram

Derive from:

* Applications
* Services
* Modules
* Dependencies
* Databases
* Queues/brokers
* External systems
* Runtime relationships

Show meaningful communication or dependency relationships.

Do not simply reproduce the folder structure.

---

## Use Case Diagram

Derive actors and use cases from:

* Routes/endpoints
* UI functionality
* Controllers
* Services
* Roles/permissions
* Documented user workflows

Do not invent actors or functionality.

---

## ER/Data Model Diagram

Derive from:

* Database schemas
* ORM models
* Migrations
* Foreign keys
* Constraints
* Relationships

Represent actual persisted entities.

Do not infer nonexistent tables from application concepts.

---

## Class Diagram

Derive from actual:

* Classes
* Interfaces
* Inheritance
* Composition
* Dependencies
* Important properties/methods

Avoid producing a massive diagram containing every class.

Focus on meaningful domain or architectural relationships.

---

## Sequence Diagram

Trace a real implemented flow through:

* Entry point
* Controller/API
* Services
* Database
* Queues
* Workers
* External systems

Use actual implementation paths wherever possible.

Do not invent interactions simply because they are architecturally common.

---

## Activity Diagram

Derive from actual control flow:

* Conditions
* Validation
* Processing
* Success paths
* Failure paths
* Retry paths
* State changes

Represent meaningful workflows rather than source-code line-by-line execution.

---

## State Diagram

Use actual state definitions and transitions.

Identify:

* States
* Valid transitions
* Triggering actions
* Terminal states
* Failure states

Do not invent state transitions.

---

## Deployment Diagram

Derive from:

* Dockerfiles
* Compose files
* Kubernetes manifests
* Infrastructure configuration
* CI/CD
* Runtime configuration

Represent actual deployment relationships where possible.

---

# Accuracy Rules

The diagrams must reflect the implementation.

### Never invent:

* Services
* Modules
* APIs
* Database tables
* Relationships
* Queues
* Workers
* External services
* Authentication mechanisms
* User roles
* Features
* Deployment infrastructure

If something cannot be verified, either:

* omit it, or
* clearly mark it as proposed/future architecture when the user explicitly asks for proposed architecture.

---

# Abstraction Rules

Do not make diagrams unnecessarily detailed.

Use the appropriate abstraction level.

### High-level diagrams

Show:

* Major systems
* Major components
* Data stores
* Important external dependencies

### Mid-level diagrams

Show:

* Modules
* Services
* Important interactions
* Major data flows

### Low-level diagrams

Show:

* Classes
* Methods
* Detailed entities
* Specific processing steps

Avoid mixing all abstraction levels into one diagram unless there is a clear reason.

---

# Diagram Quality

Every diagram should be:

* Readable
* Professionally structured
* Consistent
* Semantically accurate
* Appropriately scoped
* Easy to maintain
* Useful without requiring the source code to be open

Avoid:

* Excessive crossing lines
* Huge diagrams
* Redundant nodes
* Unnecessary implementation details
* Decorative elements that reduce clarity
* Generic architecture boxes unsupported by the code

Prefer multiple focused diagrams over one overloaded diagram.

---

# Diagram Format

Prefer **Mermaid** as the primary source format when it can represent the required diagram clearly.

Use an appropriate Mermaid diagram type such as:

* `flowchart`
* `sequenceDiagram`
* `classDiagram`
* `stateDiagram`
* `erDiagram`
* `C4Context` / supported C4 syntax where appropriate

If Mermaid cannot adequately represent a required diagram, use another suitable format available in the project environment.

Keep diagram source files editable.

---

# Output Organization

Unless the repository already defines another documentation structure, use:

```text
docs/
└── diagrams/
    ├── README.md
    ├── source/
    ├── svg/
    └── png/
```

Use descriptive filenames.

Example:

```text
docs/diagrams/source/system-architecture.mmd
docs/diagrams/source/authentication-sequence.mmd
docs/diagrams/source/database-erd.mmd
```

Generated images should correspond to their source diagrams.

---

# Rendering

If Mermaid rendering is required:

1. Check whether a Mermaid renderer is already available.
2. Prefer project-installed tooling.
3. If `mmdc` is available, it may be used to generate SVG/PNG.
4. Do not install large dependencies unnecessarily.
5. Keep source diagrams even when rendered images are generated.

---

# Validation

Before considering a diagram complete:

* Verify every important node against the implementation.
* Verify relationships.
* Verify names.
* Verify data entities.
* Verify flow direction.
* Check for Mermaid syntax errors.
* Render the diagram when possible.
* Inspect the rendered result for readability.
* Correct layout problems.

If an existing diagram contradicts the implementation, update the diagram rather than preserving inaccurate documentation.

---

# Change Awareness

When updating an existing project:

1. Check the current diagram source.
2. Identify implementation changes.
3. Determine which diagrams are affected.
4. Update only affected diagrams.
5. Re-render them.
6. Validate the result.

Do not regenerate unrelated diagrams unnecessarily.

---

# Proposed Architecture

If the user explicitly requests a **proposed**, **future**, or **target** architecture:

* Clearly distinguish it from the current implementation.
* Base current-state elements on repository evidence.
* Clearly identify proposed elements.
* Never present proposed components as currently implemented.

If the user asks for diagrams of the current system, do not introduce proposed architecture.

---

# Git Safety

Do not modify unrelated project files.

Before making changes:

* Check repository status.
* Understand existing modifications.
* Avoid overwriting unrelated user work.

After generating diagrams, report:

* Files created
* Files updated
* Diagram types generated
* Any assumptions or unresolved evidence
* Any rendering limitations

Do not commit unless the user explicitly requests a commit.

---

# User Commands

The following are valid examples:

```text
Use project-diagrams and generate the appropriate technical diagrams for this codebase.
```

```text
Use project-diagrams to generate the architecture, database, and sequence diagrams.
```

```text
Use project-diagrams to update the existing diagrams based on the latest implementation.
```

```text
Use project-diagrams to review the existing diagrams against the current codebase and fix inaccuracies.
```

```text
Use project-diagrams to generate a proposed target architecture.
```

---

# Final Report

After completing the work, provide a concise report containing:

```text
Diagrams generated:
- <diagram>
- <diagram>

Files:
- <path>
- <path>

Validation:
- <result>

Notes:
- <important limitation or unresolved evidence, if any>
```

Do not provide unnecessary explanations of the implementation unless requested.

---

# Critical Rule

This skill must remain:

* Technology agnostic
* Domain agnostic
* Organization agnostic
* Project-type agnostic
* Documentation-purpose agnostic

The skill defines **how to discover and visualize a software system**, not what that software system is.

All project-specific technologies, architecture, domain concepts, diagrams, and documentation requirements must be discovered from the user's repository or explicitly provided requirements.
