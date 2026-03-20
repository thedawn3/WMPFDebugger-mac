SHELL := /bin/zsh

.PHONY: help install up stable compat full doctor probe-basic probe-advanced probe-live clean

help:
	@printf '%s\n' \
	'Available targets:' \
	'  make install        # install dependencies with yarn' \
	'  make up             # one-click launch with environment checks' \
	'  make stable         # start lowest-risk hook mode' \
	'  make compat         # start compatibility mode' \
	'  make full           # start full research mode' \
	'  make doctor         # inspect WeChat / WeApp process state' \
	'  make probe-basic    # run basic CDP validation' \
	'  make probe-advanced # run advanced CDP validation' \
	'  make probe-live     # run live validation helper'

install:
	yarn

up:
	yarn start:guided

stable:
	yarn start:stable

compat:
	yarn start:compat

full:
	yarn start:full

doctor:
	yarn doctor

probe-basic:
	yarn probe:basic

probe-advanced:
	yarn probe:advanced

probe-live:
	yarn probe:live
