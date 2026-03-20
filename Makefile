SHELL := /bin/zsh

.PHONY: help install up up-open up-stable up-stable-open stable compat full doctor open-devtools probe-basic probe-advanced probe-live clean

help:
	@printf '%s\n' \
	'Available targets:' \
	'  make install        # install dependencies with yarn' \
	'  make up             # one-click launch in full mode with environment checks' \
	'  make up-open        # one-click full mode launch and auto-open Chrome DevTools' \
	'  make up-stable      # one-click stable launch with environment checks' \
	'  make up-stable-open # one-click stable launch and auto-open Chrome DevTools' \
	'  make stable         # start lowest-risk hook mode' \
	'  make compat         # start compatibility mode' \
	'  make full           # start full research mode' \
	'  make doctor         # inspect WeChat / WeApp process state' \
	'  make open-devtools  # open Chrome DevTools for ws://127.0.0.1:62000' \
	'  make probe-basic    # run basic CDP validation' \
	'  make probe-advanced # run advanced CDP validation' \
	'  make probe-live     # run live validation helper'

install:
	yarn

up:
	yarn start:guided

up-open:
	yarn start:guided:open

up-stable:
	yarn start:guided:stable

up-stable-open:
	yarn start:guided:stable:open

stable:
	yarn start:stable

compat:
	yarn start:compat

full:
	yarn start:full

doctor:
	yarn doctor

open-devtools:
	yarn open:devtools

probe-basic:
	yarn probe:basic

probe-advanced:
	yarn probe:advanced

probe-live:
	yarn probe:live
