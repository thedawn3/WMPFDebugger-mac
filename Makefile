SHELL := /bin/zsh

.PHONY: help install stable compat full probe-basic probe-advanced probe-live clean

help:
	@printf '%s\n' \
	'Available targets:' \
	'  make install        # install dependencies with yarn' \
	'  make stable         # start lowest-risk hook mode' \
	'  make compat         # start compatibility mode' \
	'  make full           # start full research mode' \
	'  make probe-basic    # run basic CDP validation' \
	'  make probe-advanced # run advanced CDP validation' \
	'  make probe-live     # run live validation helper'

install:
	yarn

stable:
	yarn start:stable

compat:
	yarn start:compat

full:
	yarn start:full

probe-basic:
	yarn probe:basic

probe-advanced:
	yarn probe:advanced

probe-live:
	yarn probe:live
